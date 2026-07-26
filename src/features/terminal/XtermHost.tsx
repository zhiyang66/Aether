import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
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
  setLiveTerm,
  type LiveTerm,
} from "./termRegistry";
import { resolveTerminalShortcut } from "../../lib/terminalShortcuts";

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
  const searchInputRef = useRef<HTMLInputElement>(null);
  // mirror suggestOpen for term.onData closure
  const suggestOpenRef = useRef(false);
  suggestOpenRef.current = suggestOpen;

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
      fontFamily: `"${settings.fontFamily}", Cascadia Code, Consolas, monospace`,
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

    const live: LiveTerm = {
      term,
      fit,
      ptyId: null,
      host,
      disposed: false,
      sessionCleanups: [],
      search,
    };
    setLiveTerm(paneId, live);

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

    // Terminal chords: Ctrl+C (copy | SIGINT), Ctrl+V paste, Ctrl+L clear
    // return false → we handled it (block xterm default); true → pass to xterm/PTY
    term.attachCustomKeyEventHandler((ev) => {
      // Terminal-local features (search, block jumps) — before generic chords
      if (ev.type === "keydown") {
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
        void navigator.clipboard
          .readText()
          .then((t) => {
            if (!t) {
              useWorkbenchStore.getState().toastMsg("剪贴板为空");
              return;
            }
            const pid = live.ptyId;
            if (pid && !live.disposed) {
              void ptyWrite(pid, t);
            } else {
              useWorkbenchStore.getState().toastMsg("终端未就绪");
            }
          })
          .catch(() => useWorkbenchStore.getState().toastMsg("无法读取剪贴板"));
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

        const settingsCwd = useSettingsStore.getState().cwd;
        const prof =
          (profileId ? useShellCatalogStore.getState().getById(profileId) : undefined) ||
          useShellCatalogStore.getState().getByShellKey(shellKey);

        // Listen BEFORE create so the shell banner/prompt is not lost
        // (reader thread emits as soon as the process starts).
        let liveId: string | null = null;
        const earlyChunks: { id: string; data: number[] | Uint8Array }[] = [];
        let cwdProbe = "";

        const ingest = (ev: { id: string; data: number[] | Uint8Array }) => {
          if (live.disposed) return;
          if (liveId && ev.id !== liveId) return;
          if (!liveId) {
            earlyChunks.push(ev);
            return;
          }
          const bytes = ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data);
          term.write(bytes);
          try {
            const text = new TextDecoder().decode(bytes);
            cwdProbe = (cwdProbe + text).slice(-4000);
            const cwdHit = detectCwdFromOutput(cwdProbe);
            if (cwdHit) setPaneCwd(paneId, cwdHit);
            appendPaneOutput(paneId, stripAnsi(text));
          } catch {
            /* ignore */
          }
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

        const id = await ptyCreate({
          shellKey: prof?.shellKey || shellKey,
          cwd: settingsCwd || cwd || undefined,
          cols: Math.max(term.cols, 40),
          rows: Math.max(term.rows, 10),
          path: prof?.path,
          args: prof?.args,
          integration: useSettingsStore.getState().shellIntegration,
        });
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
          if (data === "\t" && suggestOpenRef.current) return;
          for (const line of lineBufRef.current.push(data)) {
            recordCommand(line, shellKey, historyLimit);
            notePaneCommand(paneId, line);
            tracker.noteSubmittedCommand(line);
            setSuggestOpen(false);
            setSuggestPrefix("");
          }
          const peek = lineBufRef.current.peek();
          setSuggestPrefix(peek);
          setSuggestOpen(peek.trim().length >= 1);
          void ptyWrite(pid, data);
        });
        live.sessionCleanups.push(() => dataDisp.dispose());
      } catch (e) {
        term.writeln(`\x1b[31mPTY 启动失败: ${e instanceof Error ? e.message : e}\x1b[0m`);
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
    live.term.options.fontFamily = `"${fontFamily}", Cascadia Code, Consolas, monospace`;
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
    if (active) getLiveTerm(paneId)?.term.focus();
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
