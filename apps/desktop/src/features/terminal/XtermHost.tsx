import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { BlockTracker, clearBlocks, getBlocks, formatDuration } from "../../lib/commandBlocks";
import { isTauri } from "../../lib/window";
import { onPtyData, onPtyExit, ptyClose, ptyCreate, ptyResize, ptyWrite } from "../../ipc/pty";
import { useSettingsStore } from "../../store/settingsStore";
import { appendPaneOutput, clearPaneOutput } from "../../lib/paneRegistry";
import { detectCwdFromOutput, fileUrlToPath, stripAnsi } from "../../lib/osc";
import { findLeaf } from "../../lib/layout";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useShellCatalogStore } from "../../store/shellCatalogStore";
import { recordCommand } from "../../lib/commandHistory";
import { CommandLineBuffer } from "../../lib/commandBuffer";
import { XtermSuggest } from "../../components/XtermSuggest";
import { getPreset } from "../../lib/themes";
import { colorWithAlpha } from "../../lib/windowMaterial";
import { restoreSnapshot } from "../../lib/outputSnapshot";
import {
  attachHost,
  deleteLiveTerm,
  getLiveTerm,
  hasLiveTerm,
  listAllLiveTerms,
  setLiveTerm,
  type LiveTerm,
} from "./termRegistry";
import { ctrlEnterSequenceForShell, resolveTerminalShortcut } from "../../lib/terminalShortcuts";
import { prepareTerminalPaste } from "../../lib/terminalPaste";
import {
  agentTuiCtrlEnterSequence,
  agentTuiFromShellKey,
  detectAgentTuiFromOutput,
  type AgentTuiKind,
} from "../../lib/agentTui";
import {
  clipboardHasImage,
  quoteShellPath,
  readClipboardImage,
  readClipboardImageFromData,
  savePastedImage,
} from "../../lib/imagePaste";
import { setTermRendererLive } from "../../lib/termRenderer";
import { InlineK } from "./InlineK";

/** Try WebGL glyph backend; on any failure leave Canvas (xterm default). */
function tryAttachWebgl(term: Terminal, live: LiveTerm): "webgl" | "canvas" {
  try {
    const addon = new WebglAddon();
    // Context loss → drop WebGL so xterm can keep painting via Canvas.
    addon.onContextLoss(() => {
      try {
        addon.dispose();
      } catch {
        /* ignore */
      }
      live.renderer = "canvas";
      live.webglDispose = undefined;
      publishRendererBadge();
    });
    term.loadAddon(addon);
    live.webglDispose = () => {
      try {
        addon.dispose();
      } catch {
        /* ignore */
      }
    };
    live.renderer = "webgl";
    return "webgl";
  } catch {
    live.renderer = "canvas";
    live.webglDispose = undefined;
    return "canvas";
  }
}

/** Status-bar badge: prefer active pane, else any live session. */
function publishRendererBadge(preferPaneId?: string) {
  const preferred = preferPaneId ? getLiveTerm(preferPaneId) : undefined;
  const live =
    preferred && !preferred.disposed
      ? preferred
      : listAllLiveTerms().find((x) => x.live.renderer)?.live;
  if (!live?.renderer) {
    setTermRendererLive("n/a");
    return;
  }
  setTermRendererLive(live.renderer);
}

type Props = {
  paneId: string;
  shellKey: string;
  profileId?: string;
  cwd: string;
  active: boolean;
  onPtyId?: (id: string | null) => void;
};

/**
 * Keeps xterm + PTY in a module registry so split-layout remounts
 * do not destroy existing sessions.
 */
export function XtermHost({ paneId, shellKey, profileId, cwd, active, onPtyId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const lineBufRef = useRef(new CommandLineBuffer());
  const [suggestPrefix, setSuggestPrefix] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [kbarOpen, setKbarOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const cursorBlink = useSettingsStore((s) => s.cursorBlink);
  const cursorStyle = useSettingsStore((s) => s.cursorStyle);
  const historyLimit = useSettingsStore((s) => s.historyLimit);
  const themePreset = useSettingsStore((s) => s.themePreset);
  const uiOpacity = useSettingsStore((s) => s.uiOpacity);
  const startupCmd = useSettingsStore((s) => s.startupCmd);
  const setPaneCwd = useWorkbenchStore((s) => s.setPaneCwd);
  const notePaneCommand = useWorkbenchStore((s) => s.notePaneCommand);

  const onPickSuggest = useCallback(
    (cmd: string, run: boolean) => {
      const live = getLiveTerm(paneId);
      if (!live?.ptyId || !live.term) return;
      const cur = lineBufRef.current.peek();
      if (cur) {
        void ptyWrite(live.ptyId, "\x15");
        lineBufRef.current.reset();
      }
      void ptyWrite(live.ptyId, run ? `${cmd}\r` : cmd);
      if (run) {
        recordCommand(cmd, shellKey, historyLimit);
        notePaneCommand(paneId, cmd);
        live.blocks?.noteSubmittedCommand(cmd);
        lineBufRef.current.reset();
      } else {
        lineBufRef.current.push(cmd);
      }
      setSuggestOpen(false);
      setSuggestPrefix("");
      live.term.focus();
    },
    [historyLimit, notePaneCommand, paneId, shellKey],
  );

  useEffect(() => {
    if (!hostRef.current || !isTauri()) return;
    const host = hostRef.current;

    // ── Remount: reuse healthy session (has PTY). Half-created sessions
    // (StrictMode double-mount cancelled before ptyId) are discarded below. ──
    if (hasLiveTerm(paneId)) {
      const existing = getLiveTerm(paneId);
      if (existing && !existing.disposed && existing.ptyId) {
        const live = attachHost(paneId, host);
        if (live) {
          onPtyId?.(live.ptyId);
          const ro = new ResizeObserver(() => {
            try {
              live.fit.fit();
              if (live.ptyId) void ptyResize(live.ptyId, live.term.cols, live.term.rows);
            } catch {
              /* ignore */
            }
          });
          ro.observe(host);
          return () => {
            ro.disconnect();
            // keep session alive
          };
        }
      }
      // Stale / no-PTY entry — dispose so we create a fresh session
      void disposePaneSession(paneId);
    }

    // ── New session ──────────────────────────────────────────────
    const preset = getPreset(useSettingsStore.getState().themePreset);
    const settings = useSettingsStore.getState();
    const op = Math.min(100, Math.max(40, settings.uiOpacity ?? 100)) / 100;
    const term = new Terminal({
      cursorBlink: settings.cursorBlink,
      cursorStyle:
        settings.cursorStyle === "bar"
          ? "bar"
          : settings.cursorStyle === "underline"
            ? "underline"
            : "block",
      fontSize: settings.fontSize,
      // Emoji / CJK fall back to system color fonts (Segoe UI Emoji etc.) —
      // Cascadia Code alone renders many emoji as tofu (□).
      fontFamily: `"${settings.fontFamily}", Cascadia Code, Consolas, "Segoe UI Emoji", "Segoe UI Symbol", "Apple Color Emoji", "Noto Color Emoji", monospace`,
      // Match the denser, more legible Agent body text without giving up terminal alignment.
      fontWeight: 500,
      // Required: without this, theme.background "transparent" is painted as solid black
      allowTransparency: true,
      theme: {
        // .panes paints the only translucent fill (--bg); canvas must not cover it
        background: "#00000000",
        foreground: preset.termFg,
        cursor: preset.termCursor,
        selectionBackground: colorWithAlpha("#3d4f5f", Math.min(1, op + 0.15)),
      },
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    const search = new SearchAddon();
    term.loadAddon(search);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* ignore */
    }

    // Detect Codex / Claude full-screen composers so Ctrl+Enter can emit the
    // newline sequence those TUIs already understand (ESC CR / Alt+Enter).
    //
    // Codex write-gate (cursor flicker during Working):
    // Codex repaints status ~every 32ms with MoveTo+Print while the hardware
    // caret is still "shown", then frame-end moves it to the composer. A short
    // post-write release (e.g. 12ms) unfreezes BETWEEN frames → visible flash.
    // Hold the freeze across the whole Working burst; only restore after the
    // stream has been quiet longer than one animation frame.
    let agentTui: AgentTuiKind | null = agentTuiFromShellKey(shellKey);
    const coreService = (
      term as unknown as { _core?: { coreService?: { isCursorHidden: boolean } } }
    )._core?.coreService;
    /** Last DECTCEM show/hide from the app (?25h / ?25l). true = hidden. */
    let codexDecHidden = false;
    /** In-flight term.write batches for Codex. */
    let codexWritePending = 0;
    let codexReleaseTimer: number | null = null;
    /**
     * While Working (or any high-frequency Codex redraw) is active, keep the
     * hardware caret frozen even between individual write callbacks.
     * Extended on each gated write; cleared after quiet period.
     */
    let codexAnimHold = false;
    /** Working is ~32ms/frame; stay frozen until quiet past ~2 frames. */
    const CODEX_ANIM_QUIET_MS = 90;
    /** Idle typing redraws are sparse — release sooner when not in anim hold. */
    const CODEX_IDLE_RELEASE_MS = 24;
    /**
     * Last stable helper-textarea position (composer). xterm repositions the
     * IME target on every cursor move — during Working that follows MoveTo
     * paint traffic and steals the IME window. Pin to this while gated or
     * while a CJK composition is in progress.
     */
    let imeAnchor: { left: string; top: string; width: string; height: string } | null = null;
    /** True between compositionstart and compositionend on the helper textarea. */
    let imeComposing = false;
    let imeRaf = 0;
    let imeStyleObserver: MutationObserver | null = null;
    let imeApplying = false;

    const setCoreCursorHidden = (hidden: boolean) => {
      if (!coreService) return;
      try {
        coreService.isCursorHidden = hidden;
      } catch {
        /* ignore */
      }
    };

    const codexGateActive = () =>
      agentTui === "codex" && (codexWritePending > 0 || codexAnimHold);

    /** Pin IME whenever Codex is painting OR the user is mid-composition. */
    const imePinActive = () =>
      agentTui === "codex" && (codexGateActive() || imeComposing);

    const readTextareaAnchor = () => {
      const ta = term.textarea;
      if (!ta) return null;
      const { left, top, width, height } = ta.style;
      // xterm parks the textarea at left:-9999em when idle; ignore that.
      if (!left || !top || left.startsWith("-")) return null;
      return { left, top, width: width || "1px", height: height || "1px" };
    };

    const applyImeAnchor = () => {
      if (!imeAnchor) return;
      imeApplying = true;
      try {
        const ta = term.textarea;
        if (ta) {
          ta.style.left = imeAnchor.left;
          ta.style.top = imeAnchor.top;
          ta.style.width = imeAnchor.width;
          ta.style.height = imeAnchor.height;
          ta.style.lineHeight = imeAnchor.height;
        }
        const comp = term.element?.querySelector(".composition-view") as HTMLElement | null;
        if (comp) {
          comp.style.left = imeAnchor.left;
          comp.style.top = imeAnchor.top;
          if (imeComposing) {
            comp.style.height = imeAnchor.height;
            comp.style.lineHeight = imeAnchor.height;
          }
        }
      } finally {
        // Defer clearing so MutationObserver callbacks from our own writes skip.
        queueMicrotask(() => {
          imeApplying = false;
        });
      }
    };

    /** Remember composer IME spot only when not mid-Working / mid-pin. */
    const captureImeAnchorIfStable = () => {
      if (agentTui !== "codex" || imePinActive()) return;
      const next = readTextareaAnchor();
      if (next) imeAnchor = next;
    };

    const rePinImeSoon = () => {
      if (!imePinActive() || !imeAnchor) return;
      applyImeAnchor();
      if (imeRaf) cancelAnimationFrame(imeRaf);
      imeRaf = requestAnimationFrame(() => {
        imeRaf = 0;
        if (imePinActive()) applyImeAnchor();
        // CompositionHelper.updateCompositionElements uses setTimeout(0);
        // beat it with another pin on the next macrotask.
        window.setTimeout(() => {
          if (imePinActive()) applyImeAnchor();
        }, 0);
      });
    };

    const ensureImeStyleObserver = () => {
      if (imeStyleObserver || typeof MutationObserver === "undefined") return;
      const ta = term.textarea;
      const comp = term.element?.querySelector(".composition-view") as HTMLElement | null;
      if (!ta && !comp) return;
      imeStyleObserver = new MutationObserver(() => {
        if (imeApplying || !imePinActive()) return;
        applyImeAnchor();
      });
      const opts: MutationObserverInit = { attributes: true, attributeFilter: ["style", "class"] };
      if (ta) imeStyleObserver.observe(ta, opts);
      if (comp) imeStyleObserver.observe(comp, opts);
    };

    const scheduleCodexCursorRelease = (delayMs: number) => {
      if (codexReleaseTimer != null) window.clearTimeout(codexReleaseTimer);
      codexReleaseTimer = window.setTimeout(() => {
        codexReleaseTimer = null;
        if (codexWritePending > 0 || agentTui !== "codex") return;
        // Keep freeze while the user is still composing — Working may resume.
        if (imeComposing) {
          scheduleCodexCursorRelease(CODEX_ANIM_QUIET_MS);
          return;
        }
        codexAnimHold = false;
        setCoreCursorHidden(codexDecHidden);
        try {
          const y = term.buffer.active.cursorY;
          term.refresh(y, y);
        } catch {
          /* ignore */
        }
        window.setTimeout(() => {
          captureImeAnchorIfStable();
        }, 0);
      }, delayMs);
    };

    const beginCodexWriteGate = (fromWorkingAnim: boolean) => {
      if (agentTui !== "codex") return;
      if (codexReleaseTimer != null) {
        window.clearTimeout(codexReleaseTimer);
        codexReleaseTimer = null;
      }
      // Snapshot composer IME position before the first paint of a burst.
      if (!imePinActive()) captureImeAnchorIfStable();
      if (fromWorkingAnim) codexAnimHold = true;
      // High-frequency writes without the Working string still mean animation
      // (diff-only frames). Keep hold if we already had one or are composing.
      if (imeComposing) codexAnimHold = true;
      codexWritePending += 1;
      setCoreCursorHidden(true);
      ensureImeStyleObserver();
      rePinImeSoon();
    };

    const endCodexWriteGate = () => {
      if (agentTui !== "codex") return;
      codexWritePending = Math.max(0, codexWritePending - 1);
      if (codexWritePending > 0) return;
      // Working burst / composition: wait past frame interval.
      // Quiet typing: shorter release so the composer caret comes back.
      const hold = codexAnimHold || imeComposing;
      scheduleCodexCursorRelease(hold ? CODEX_ANIM_QUIET_MS : CODEX_IDLE_RELEASE_MS);
    };

    // xterm repositions the helper textarea on every cursor move / render
    // (CoreBrowserTerminal._syncTextArea) and again from CompositionHelper
    // via setTimeout(0). Re-pin after each, plus MutationObserver for style.
    const imePinCursorDisp = term.onCursorMove(() => {
      if (imePinActive()) rePinImeSoon();
      else captureImeAnchorIfStable();
    });
    const imePinRenderDisp = term.onRender(() => {
      if (imePinActive()) rePinImeSoon();
    });

    // Capture a stable anchor at the moment composition begins, then pin for
    // the entire composition — even if Working frames lack the "Working ("
    // substring (diff-only cell updates).
    const onCompositionStart = () => {
      if (agentTui !== "codex") return;
      // Prefer existing stable anchor; if none, take current (composer) spot.
      if (!imeAnchor) {
        const next = readTextareaAnchor();
        if (next) imeAnchor = next;
      }
      imeComposing = true;
      codexAnimHold = true; // treat composition like an anim hold for freeze
      setCoreCursorHidden(true);
      ensureImeStyleObserver();
      rePinImeSoon();
    };
    const onCompositionUpdate = () => {
      if (agentTui !== "codex") return;
      rePinImeSoon();
    };
    const onCompositionEnd = () => {
      if (agentTui !== "codex") return;
      imeComposing = false;
      rePinImeSoon();
      // Don't snap caret free mid-Working; let quiet timer decide.
      if (codexWritePending === 0) {
        scheduleCodexCursorRelease(CODEX_ANIM_QUIET_MS);
      }
    };
    const taForIme = term.textarea;
    if (taForIme) {
      taForIme.addEventListener("compositionstart", onCompositionStart, true);
      taForIme.addEventListener("compositionupdate", onCompositionUpdate, true);
      taForIme.addEventListener("compositionend", onCompositionEnd, true);
    }
    // Install observer once DOM helpers exist.
    ensureImeStyleObserver();

    const noteAgentTui = (kind: AgentTuiKind | null) => {
      if (kind) agentTui = kind;
    };

    // Track DECTCEM. While the gate is active, swallow ?25h so xterm cannot
    // paint the caret mid-diff or in the inter-frame gap of Working.
    const csiShowDisp = term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
      if (agentTui !== "codex") return false;
      const flat = params.flatMap((p) => (Array.isArray(p) ? p : [p]));
      if (!flat.includes(25)) return false;
      codexDecHidden = false;
      if (codexGateActive()) {
        setCoreCursorHidden(true);
        return true;
      }
      return false;
    });
    const csiHideDisp = term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
      if (agentTui !== "codex") return false;
      const flat = params.flatMap((p) => (Array.isArray(p) ? p : [p]));
      if (!flat.includes(25)) return false;
      codexDecHidden = true;
      setCoreCursorHidden(true);
      return false;
    });

    const live: LiveTerm = {
      term,
      fit,
      ptyId: null,
      host,
      disposed: false,
      sessionCleanups: [],
      search,
      renderer: "canvas",
    };
    // Renderer: auto/webgl try GPU first; canvas forces software path.
    // Must run AFTER term.open() so the addon has a DOM/canvas to attach to.
    const pref = settings.termRenderer ?? "auto";
    if (pref === "canvas") {
      live.renderer = "canvas";
    } else {
      tryAttachWebgl(term, live);
    }
    setLiveTerm(paneId, live);
    publishRendererBadge(paneId);
    live.sessionCleanups.push(() => {
      csiShowDisp.dispose();
      csiHideDisp.dispose();
      imePinCursorDisp.dispose();
      imePinRenderDisp.dispose();
      if (taForIme) {
        taForIme.removeEventListener("compositionstart", onCompositionStart, true);
        taForIme.removeEventListener("compositionupdate", onCompositionUpdate, true);
        taForIme.removeEventListener("compositionend", onCompositionEnd, true);
      }
      imeStyleObserver?.disconnect();
      imeStyleObserver = null;
      if (imeRaf) cancelAnimationFrame(imeRaf);
      if (codexReleaseTimer != null) window.clearTimeout(codexReleaseTimer);
      try {
        live.webglDispose?.();
      } catch {
        /* ignore */
      }
      // Refresh badge from remaining sessions after this one goes away
      window.setTimeout(() => publishRendererBadge(), 0);
    });

    // ── Command blocks (OSC 133) + cwd (OSC 7) via xterm's own OSC parser ──
    const tracker = new BlockTracker(paneId);
    live.blocks = tracker;
    const osc133 = term.parser.registerOscHandler(133, (payload) => {
      const done = tracker.handleMark(payload, {
        marker: () => {
          try {
            return term.registerMarker(0);
          } catch {
            return null;
          }
        },
        cwd: () => {
          const st = useWorkbenchStore.getState();
          for (const tab of st.tabs) {
            const leaf = findLeaf(tab.layout, paneId);
            if (leaf) return leaf.cwd || null;
          }
          return null;
        },
      });
      if (done) {
        // Failed block → red gutter line at the command position
        if (done.exitCode != null && done.exitCode !== 0 && done.marker && !done.marker.isDisposed) {
          try {
            const deco = term.registerDecoration({ marker: done.marker });
            deco?.onRender((el) => {
              el.classList.add("term-block-fail");
            });
          } catch {
            /* ignore */
          }
        }
        // Long-command completion notification when the window is hidden/unfocused
        const s = useSettingsStore.getState();
        const durMs = (done.endedAt ?? Date.now()) - done.startedAt;
        if (
          s.notifyOnLongCommand &&
          durMs >= Math.max(3, s.notifyThresholdSec) * 1000 &&
          (document.hidden || !document.hasFocus())
        ) {
          void notifyBlockDone(
            done.command || "命令",
            done.exitCode,
            formatDuration(durMs),
          );
        }
      }
      return true;
    });
    live.sessionCleanups.push(() => osc133.dispose());

    const osc7 = term.parser.registerOscHandler(7, (payload) => {
      const cwd = fileUrlToPath(payload);
      if (cwd) setPaneCwd(paneId, cwd);
      return true;
    });
    live.sessionCleanups.push(() => osc7.dispose());
    live.sessionCleanups.push(() => clearBlocks(paneId));

    const writeClipboardText = (text: string) => {
      const prepared = prepareTerminalPaste(text, shellKey);
      if (!prepared.ok) {
        useWorkbenchStore.getState().toastMsg(prepared.reason);
        return;
      }
      if (live.ptyId && !live.disposed) {
        void ptyWrite(live.ptyId, prepared.payload);
      } else {
        useWorkbenchStore.getState().toastMsg("终端未就绪");
      }
    };

    const writeClipboardImage = async (image: Awaited<ReturnType<typeof readClipboardImage>>) => {
      if (!image) {
        useWorkbenchStore.getState().toastMsg("剪贴板中没有可用图片");
        return;
      }
      try {
        const path = await savePastedImage(image);
        writeClipboardText(quoteShellPath(path, shellKey));
        useWorkbenchStore.getState().toastMsg("已插入图片文件路径");
      } catch (e) {
        useWorkbenchStore.getState().toastMsg(
          `粘贴图片失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    };

    // Capture browser-native paste too (context menu / OS paste), not only Ctrl+V.
    const onNativePaste = (ev: ClipboardEvent) => {
      const text = ev.clipboardData?.getData("text/plain") || "";
      if (text) {
        ev.preventDefault();
        ev.stopPropagation();
        writeClipboardText(text);
        return;
      }
      if (clipboardHasImage(ev.clipboardData)) {
        ev.preventDefault();
        ev.stopPropagation();
        void readClipboardImageFromData(ev.clipboardData).then(writeClipboardImage);
      }
    };
    host.addEventListener("paste", onNativePaste, true);
    live.sessionCleanups.push(() => host.removeEventListener("paste", onNativePaste, true));

    // Terminal chords: Ctrl+C (copy | SIGINT), Ctrl+V paste, Ctrl+L clear
    // return false → we handled it (block xterm default); true → pass to xterm/PTY
    term.attachCustomKeyEventHandler((ev) => {
      // Block every event in this physical Ctrl+Enter sequence. Handling only
      // keydown lets a later keypress leak through as a plain Enter, which
      // immediately submits the line in full-screen CLIs such as Codex/Claude.
      // User-facing chord is Ctrl+Enter; for agent TUIs we emit the same
      // bytes as native Alt+Enter (ESC CR), which those composers already
      // treat as "insert newline".
      const isCtrlEnter =
        ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey && ev.key === "Enter";
      if (isCtrlEnter) {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.type === "keydown") {
          const ctrlEnterSequence = agentTuiCtrlEnterSequence({
            kind: agentTui,
            alternateScreen: term.buffer.active === term.buffer.alternate,
            bracketedPasteMode: !!term.modes.bracketedPasteMode,
            shellKey,
            fallback: ctrlEnterSequenceForShell,
          });
          if (ctrlEnterSequence && live.ptyId && !live.disposed) {
            void ptyWrite(live.ptyId, ctrlEnterSequence);
          }
        }
        return false;
      }

      // Terminal-local features (search, block jumps) — before generic chords
      if (ev.type === "keydown") {
        // Some Chromium/IME combinations do not forward Home/End reliably to
        // xterm. Send the standard shell line-editing sequences directly.
        if (
          !ev.ctrlKey &&
          !ev.metaKey &&
          !ev.altKey &&
          !ev.shiftKey &&
          (ev.key === "Home" || ev.key === "End")
        ) {
          ev.preventDefault();
          if (live.ptyId && !live.disposed) {
            void ptyWrite(live.ptyId, ev.key === "Home" ? "\x1b[H" : "\x1b[F");
          }
          return false;
        }
        const mod = ev.ctrlKey || ev.metaKey;
        if (mod && ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "f") {
          ev.preventDefault();
          setSearchOpen(true);
          window.setTimeout(() => searchInputRef.current?.focus(), 30);
          return false;
        }
        if (mod && ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
          ev.preventDefault();
          jumpToBlock(term, paneId, ev.key === "ArrowUp" ? -1 : 1);
          return false;
        }
        // 1.0: inline Ctrl+K natural-language → command
        if (mod && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "k") {
          ev.preventDefault();
          setKbarOpen(true);
          return false;
        }
      }
      const selection = (() => {
        try {
          return term.getSelection() || "";
        } catch {
          return "";
        }
      })();
      const resolved = resolveTerminalShortcut(ev, {
        hasSelection: selection.trim().length > 0,
        selection,
      });

      if (resolved.action === "pass") return true;

      if (resolved.action === "workbench") {
        // Block xterm (no control bytes to the shell); do NOT preventDefault —
        // the event must bubble to the window-level workbench chord handler.
        return false;
      }

      if (resolved.action === "sigint") {
        // Let xterm emit \x03 via onData → PTY
        return true;
      }

      // Stop browser/xterm from also handling copy/paste/clear (avoids double-paste)
      ev.preventDefault();
      ev.stopPropagation();

      if (resolved.action === "copy") {
        const text = resolved.text;
        if (!text) {
          useWorkbenchStore.getState().toastMsg("没有选中内容");
        } else {
          void navigator.clipboard.writeText(text).then(
            () => useWorkbenchStore.getState().toastMsg("已复制"),
            () => useWorkbenchStore.getState().toastMsg("复制失败"),
          );
        }
        return false;
      }

      if (resolved.action === "paste") {
        void navigator.clipboard.readText().then(
          (text) => {
            if (text) {
              writeClipboardText(text);
              return;
            }
            void readClipboardImage().then(writeClipboardImage).catch(() => {
              useWorkbenchStore.getState().toastMsg("无法读取剪贴板图片");
            });
          },
          () => {
            void readClipboardImage().then(writeClipboardImage).catch(() => {
              useWorkbenchStore.getState().toastMsg("无法读取剪贴板");
            });
          },
        );
        return false;
      }

      if (resolved.action === "clear") {
        useWorkbenchStore.getState().clearPane(paneId);
        return false;
      }

      return true;
    });

    // Only restore snapshot if enabled AND this pane already had history
    // (avoid dumping into brand-new panes)
    const snapEnabled = settings.outputSnapshotEnabled;
    const snap = snapEnabled ? restoreSnapshot(paneId) : "";
    if (snap?.trim() && snap.length > 20) {
      term.write(snap.replace(/\n/g, "\r\n").slice(-6000));
      if (!snap.endsWith("\n")) term.write("\r\n");
      appendPaneOutput(paneId, snap + "\n");
    }

    let cancelled = false;
    let resizeTimer: number | undefined;

    (async () => {
      try {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (cancelled || live.disposed) return;
        try {
          fit.fit();
        } catch {
          /* ignore */
        }

        const settingsCwd = useSettingsStore.getState().cwd?.trim() || "";
        // Prefer a real directory; invalid saved cwd is a common Windows spawn failure
        const preferredCwd = [settingsCwd, cwd].find((d) => d && d.length > 0) || undefined;
        const prof =
          (profileId ? useShellCatalogStore.getState().getById(profileId) : undefined) ||
          useShellCatalogStore.getState().getByShellKey(shellKey);

        // Listen BEFORE create so the shell banner/prompt is not lost
        // (reader thread emits as soon as the process starts).
        let liveId: string | null = null;
        const earlyChunks: { id: string; data: number[] | Uint8Array }[] = [];
        let cwdProbe = "";
        // One decoder per session (not per chunk): avoids per-chunk allocation
        // and, with {stream:true}, correctly joins multibyte chars split across
        // PTY chunks instead of emitting replacement characters.
        const decoder = new TextDecoder();

        const ingest = (ev: { id: string; data: number[] | Uint8Array }) => {
          if (live.disposed) return;
          if (liveId && ev.id !== liveId) return;
          if (!liveId) {
            earlyChunks.push(ev);
            return;
          }
          const bytes = ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data);
          // Decode first so Codex detection / Working markers arm the gate
          // before this same chunk is painted.
          let text = "";
          let workingAnim = false;
          try {
            text = decoder.decode(bytes, { stream: true });
            cwdProbe = (cwdProbe + text).slice(-4000);
            const cwdHit = detectCwdFromOutput(cwdProbe);
            if (cwdHit) setPaneCwd(paneId, cwdHit);
            noteAgentTui(detectAgentTuiFromOutput(text));
            // Codex status line: "Working (1.2s)" — ~32ms animation frames.
            workingAnim = /\bWorking\s*\(\d/i.test(text);
            appendPaneOutput(paneId, stripAnsi(text));
          } catch {
            /* ignore */
          }
          // Freeze hardware caret before MoveTo/Print; hold across Working.
          beginCodexWriteGate(workingAnim || codexAnimHold);
          term.write(bytes, () => {
            endCodexWriteGate();
          });
        };

        const unData = await onPtyData(ingest);
        live.sessionCleanups.push(unData);

        const unExit = await onPtyExit((ev) => {
          if (!liveId || ev.id !== liveId) return;
          term.writeln("\r\n\x1b[90m[会话已结束]\x1b[0m");
          live.ptyId = null;
          onPtyId?.(null);
        });
        live.sessionCleanups.push(unExit);

        const createOpts = {
          shellKey: prof?.shellKey || shellKey,
          cwd: preferredCwd,
          cols: Math.max(term.cols, 40),
          rows: Math.max(term.rows, 10),
          path: prof?.path,
          args: prof?.args,
          integration: useSettingsStore.getState().shellIntegration,
        };

        let id: string;
        try {
          id = await ptyCreate(createOpts);
        } catch (firstErr) {
          // Frontend safety net: retry without integration / without cwd
          const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
          term.writeln(`\x1b[33mPTY 首次启动失败，正在回退重试…\x1b[0m`);
          term.writeln(`\x1b[90m${msg}\x1b[0m`);
          try {
            id = await ptyCreate({
              ...createOpts,
              integration: false,
              cwd: undefined,
            });
            term.writeln(`\x1b[32m已用兼容模式启动（无 Shell 集成 / 默认目录）\x1b[0m`);
          } catch (secondErr) {
            throw secondErr;
          }
        }
        if (cancelled || live.disposed) {
          await ptyClose(id);
          return;
        }
        liveId = id;
        live.ptyId = id;
        // Ensure registry entry is the same object with ptyId set
        setLiveTerm(paneId, live);
        onPtyId?.(id);

        // Replay any chunks that arrived before we knew the id
        for (const ev of earlyChunks) {
          if (ev.id === id) ingest(ev);
        }
        earlyChunks.length = 0;

        try {
          fit.fit();
          void ptyResize(id, term.cols, term.rows);
        } catch {
          /* ignore */
        }

        window.setTimeout(() => {
          try {
            term.scrollToBottom();
            term.focus();
          } catch {
            /* ignore */
          }
        }, 80);

        if (startupCmd?.trim()) {
          window.setTimeout(() => {
            if (live.ptyId && !live.disposed) {
              void ptyWrite(live.ptyId, `${startupCmd.trim()}\r`);
            }
          }, 500);
        }

        const dataDisp = term.onData((data) => {
          const pid = live.ptyId;
          if (!pid || live.disposed) return;
          for (const line of lineBufRef.current.push(data)) {
            recordCommand(line, shellKey, historyLimit);
            notePaneCommand(paneId, line);
            tracker.noteSubmittedCommand(line);
            // Broadcast members get the same command text for their blocks
            const bcast = useWorkbenchStore.getState().broadcastPanes;
            if (bcast.length >= 2 && bcast.includes(paneId)) {
              for (const otherId of bcast) {
                if (otherId !== paneId) {
                  getLiveTerm(otherId)?.blocks?.noteSubmittedCommand(line);
                }
              }
            }
            setSuggestOpen(false);
            setSuggestPrefix("");
          }
          const peek = lineBufRef.current.peek();
          setSuggestPrefix(peek);
          setSuggestOpen(peek.trim().length >= 1);
          void ptyWrite(pid, data);
          // 0.9 广播输入：本窗格在广播集合中 → 镜像写入其它成员 PTY
          const bset = useWorkbenchStore.getState().broadcastPanes;
          if (bset.length >= 2 && bset.includes(paneId)) {
            for (const otherId of bset) {
              if (otherId === paneId) continue;
              const other = getLiveTerm(otherId);
              if (other && !other.disposed && other.ptyId) {
                void ptyWrite(other.ptyId, data);
              }
            }
          }
        });
        live.sessionCleanups.push(() => dataDisp.dispose());
      } catch (e) {
        term.writeln(`\x1b[31mPTY 启动失败: ${e instanceof Error ? e.message : e}\x1b[0m`);
        term.writeln(
          `\x1b[90m可在 设置 → 常规 关闭「Shell 集成」，或清空默认工作目录后重试。\x1b[0m`,
        );
      }
    })();

    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        try {
          fit.fit();
          if (live.ptyId) void ptyResize(live.ptyId, term.cols, term.rows);
        } catch {
          /* ignore */
        }
      }, 50);
    });
    ro.observe(host);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.clearTimeout(resizeTimer);
      // StrictMode: first mount often unmounts before PTY attaches.
      // Drop the orphan xterm so the remount creates a real session.
      // If PTY is already up, keep it for split-layout reattach.
      if (!live.ptyId) {
        live.disposed = true;
        for (const c of live.sessionCleanups) {
          try {
            c();
          } catch {
            /* ignore */
          }
        }
        try {
          live.term.dispose();
        } catch {
          /* ignore */
        }
        deleteLiveTerm(paneId);
      }
      // else: Do NOT dispose term/pty — split remount will reattach
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  useEffect(() => {
    const live = getLiveTerm(paneId);
    if (!live) return;
    const preset = getPreset(themePreset);
    const op = Math.min(100, Math.max(40, uiOpacity ?? 100)) / 100;
    live.term.options.fontSize = fontSize;
    live.term.options.fontFamily = `"${fontFamily}", Cascadia Code, Consolas, "Segoe UI Emoji", "Segoe UI Symbol", "Apple Color Emoji", "Noto Color Emoji", monospace`;
    live.term.options.fontWeight = 500;
    live.term.options.cursorBlink = cursorBlink;
    live.term.options.cursorStyle =
      cursorStyle === "bar" ? "bar" : cursorStyle === "underline" ? "underline" : "block";
    live.term.options.allowTransparency = true;
    live.term.options.theme = {
      background: "#00000000",
      foreground: preset.termFg,
      cursor: preset.termCursor,
      selectionBackground: colorWithAlpha("#3d4f5f", Math.min(1, op + 0.15)),
    };
    try {
      live.fit.fit();
      if (live.ptyId) void ptyResize(live.ptyId, live.term.cols, live.term.rows);
    } catch {
      /* ignore */
    }
  }, [fontSize, fontFamily, cursorBlink, cursorStyle, themePreset, uiOpacity, paneId]);

  // Live opacity: CSS --bg on .panes; keep xterm canvas fully transparent
  useEffect(() => {
    const onOp = (e: Event) => {
      const detail = (e as CustomEvent<{ opacity: number }>).detail;
      const live = getLiveTerm(paneId);
      if (!live || !detail) return;
      const preset = getPreset(useSettingsStore.getState().themePreset);
      live.term.options.allowTransparency = true;
      live.term.options.theme = {
        background: "#00000000",
        foreground: preset.termFg,
        cursor: preset.termCursor,
        selectionBackground: colorWithAlpha("#3d4f5f", Math.min(1, detail.opacity + 0.15)),
      };
    };
    window.addEventListener("sw:ui-opacity", onOp);
    return () => window.removeEventListener("sw:ui-opacity", onOp);
  }, [paneId]);

  useEffect(() => {
    if (active) {
      getLiveTerm(paneId)?.term.focus();
      publishRendererBadge(paneId);
    }
  }, [active, paneId]);

  useEffect(() => {
    const onClear = (e: Event) => {
      const detail = (e as CustomEvent<{ paneId: string }>).detail;
      if (detail?.paneId !== paneId) return;
      getLiveTerm(paneId)?.term.clear();
    };
    window.addEventListener("sw:clear-pane", onClear);
    return () => window.removeEventListener("sw:clear-pane", onClear);
  }, [paneId]);

  const doSearch = (dir: "next" | "prev") => {
    const live = getLiveTerm(paneId);
    if (!live?.search || !searchQuery) return;
    try {
      if (dir === "next") live.search.findNext(searchQuery, { incremental: false });
      else live.search.findPrevious(searchQuery);
    } catch {
      /* ignore */
    }
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    try {
      getLiveTerm(paneId)?.search?.clearDecorations();
    } catch {
      /* ignore */
    }
    getLiveTerm(paneId)?.term.focus();
  };

  return (
    <div className="terminal-host-wrap">
      <div className="terminal-host" ref={hostRef} data-pane={paneId} />
      {searchOpen && (
        <div className="term-search-bar">
          <input
            ref={searchInputRef}
            className="term-search-input"
            placeholder="搜索缓冲区…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              const live = getLiveTerm(paneId);
              if (live?.search && e.target.value) {
                try {
                  live.search.findNext(e.target.value, { incremental: true });
                } catch {
                  /* ignore */
                }
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                doSearch(e.shiftKey ? "prev" : "next");
              }
              if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              }
            }}
          />
          <button type="button" className="term-search-btn" title="上一个 (Shift+Enter)" onClick={() => doSearch("prev")}>
            ↑
          </button>
          <button type="button" className="term-search-btn" title="下一个 (Enter)" onClick={() => doSearch("next")}>
            ↓
          </button>
          <button type="button" className="term-search-btn" title="关闭 (Esc)" onClick={closeSearch}>
            ×
          </button>
        </div>
      )}
      <InlineK
        paneId={paneId}
        shellKey={shellKey}
        cwd={cwd || ""}
        open={kbarOpen}
        onClose={() => {
          setKbarOpen(false);
          getLiveTerm(paneId)?.term.focus();
        }}
        onInsert={(text, run) => {
          const live = getLiveTerm(paneId);
          if (!live?.ptyId || live.disposed) return;
          if (run) {
            // User-initiated run → same channel as action chips (danger policy)
            useWorkbenchStore.getState().insertToPane(undefined, text, true);
          } else {
            live.blocks?.noteSubmittedCommand(text);
            void ptyWrite(live.ptyId, text);
          }
        }}
      />
      <XtermSuggest
        open={suggestOpen && active}
        prefix={suggestPrefix}
        shellKey={shellKey}
        onPick={onPickSuggest}
        onClose={() => setSuggestOpen(false)}
      />
    </div>
  );
}

/** Scroll to the previous/next command block marker relative to the viewport. */
function jumpToBlock(term: Terminal, paneId: string, dir: -1 | 1) {
  const blocks = getBlocks(paneId).filter(
    (b) => b.marker && !b.marker.isDisposed,
  );
  if (!blocks.length) return;
  const cur = term.buffer.active.viewportY;
  let target: number | null = null;
  if (dir < 0) {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const line = blocks[i].marker!.line;
      if (line < cur) {
        target = line;
        break;
      }
    }
    if (target == null) target = blocks[0].marker!.line;
  } else {
    for (const b of blocks) {
      const line = b.marker!.line;
      if (line > cur) {
        target = line;
        break;
      }
    }
    if (target == null) {
      term.scrollToBottom();
      return;
    }
  }
  try {
    term.scrollToLine(target);
  } catch {
    /* ignore */
  }
}

/** System notification for a finished long command (window unfocused). */
async function notifyBlockDone(command: string, exitCode: number | null, duration: string) {
  try {
    const {
      isPermissionGranted,
      requestPermission,
      sendNotification,
    } = await import("@tauri-apps/plugin-notification");
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;
    const ok = exitCode === 0 || exitCode == null;
    sendNotification({
      title: ok ? "命令完成" : `命令失败 (exit ${exitCode})`,
      body: `${command.slice(0, 80)} · ${duration}`,
    });
  } catch {
    /* notification unavailable — ignore */
  }
}

/** Permanently destroy PTY + xterm when user closes a pane. */
export async function disposePaneSession(paneId: string) {
  const live = getLiveTerm(paneId);
  if (!live) {
    clearPaneOutput(paneId);
    return;
  }
  live.disposed = true;
  for (const c of live.sessionCleanups) {
    try {
      c();
    } catch {
      /* ignore */
    }
  }
  try {
    if (live.ptyId) await ptyClose(live.ptyId);
  } catch {
    /* ignore */
  }
  try {
    live.term.dispose();
  } catch {
    /* ignore */
  }
  deleteLiveTerm(paneId);
  clearPaneOutput(paneId);
}
