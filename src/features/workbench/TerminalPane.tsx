import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutNode, LeafPane, SplitNode } from "../../lib/layout";
import { countLeaves, updateLeaf } from "../../lib/layout";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useSettingsStore } from "../../store/settingsStore";
import {
  listHistoryForShell,
  querySuggestions,
  recordCommand,
} from "../../lib/commandHistory";
import { isTauri } from "../../lib/window";
import { getLiveTerm } from "../terminal/termRegistry";
import { XtermHost } from "../terminal/XtermHost";

function LeafView({
  pane,
  leafCount,
  active,
}: {
  pane: LeafPane;
  leafCount: number;
  active: boolean;
}) {
  const setActivePane = useWorkbenchStore((s) => s.setActivePane);
  const closePane = useWorkbenchStore((s) => s.closePane);
  const setDraft = useWorkbenchStore((s) => s.setDraft);
  const historyNavigate = useWorkbenchStore((s) => s.historyNavigate);
  const runCommand = useWorkbenchStore((s) => s.runCommand);
  const clearPane = useWorkbenchStore((s) => s.clearPane);
  const useMock = useWorkbenchStore((s) => s.useMockTerminal);
  const settings = useSettingsStore();
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const [showSuggest, setShowSuggest] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [ptyId, setPtyId] = useState<string | null>(null);
  // Prefer real PTY whenever Tauri is present. useMock may be stuck true if the
  // store module evaluated before __TAURI_INTERNALS__ was injected.
  const realTerm = isTauri() ? true : !useMock;
  const shellHistory = useMemo(
    () => listHistoryForShell(pane.shellKey, 30),
    [pane.shellKey, histOpen, pane.cmdHistory.length],
  );

  const suggestions = useMemo(() => {
    if (!settings.suggestEnabled || !pane.draft.trim() || realTerm) return [];
    return querySuggestions(pane.draft, pane.shellKey, {
      max: settings.suggestMax,
      useHistory: settings.suggestHistory,
      useFrequent: settings.suggestFrequent,
      byShell: settings.historyByShell,
      fuzzy: settings.suggestFuzzy,
    });
  }, [
    pane.draft,
    pane.shellKey,
    realTerm,
    settings.suggestEnabled,
    settings.suggestMax,
    settings.suggestHistory,
    settings.suggestFrequent,
    settings.historyByShell,
    settings.suggestFuzzy,
  ]);

  useEffect(() => {
    setSuggestIdx(0);
    setShowSuggest(suggestions.length > 0);
  }, [suggestions]);

  useEffect(() => {
    if (bodyRef.current && !realTerm) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [pane.history, pane.draft, realTerm]);

  useEffect(() => {
    if (active && inputRef.current && !realTerm) {
      inputRef.current.focus();
    }
  }, [active, pane.id, realTerm]);

  // Keep ptyId on leaf for Agent insert/run
  useEffect(() => {
    if (!ptyId) return;
    useWorkbenchStore.setState((s) => {
      // Update leaf in whichever tab contains this pane
      const tabs = s.tabs.map((tab) => {
        const layout = updateLeaf(tab.layout, pane.id, (leaf) =>
          leaf.ptyId === ptyId ? leaf : { ...leaf, ptyId },
        );
        return layout === tab.layout ? tab : { ...tab, layout };
      });
      return { tabs };
    });
  }, [ptyId, pane.id]);

  const acceptSuggest = (run: boolean) => {
    const item = suggestions[suggestIdx];
    if (!item) return;
    if (run || settings.suggestAccept === "run") {
      recordCommand(item.cmd, pane.shellKey, settings.historyLimit);
      runCommand(pane.id, item.cmd);
    } else {
      setDraft(pane.id, item.cmd);
    }
    setShowSuggest(false);
  };

  return (
    <div
      className={`pane${active ? " active-pane" : ""}`}
      data-pane-id={pane.id}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest(".pane-close")) return;
        setActivePane(pane.id);
      }}
    >
      <div className="pane-header">
        <span className="ph-left">
          <span
            className="pane-num"
            title="点击复制 #序号 · Agent 可引用"
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              const tag = `#${pane.serial}`;
              void navigator.clipboard?.writeText(tag).then(
                () => useWorkbenchStore.getState().toastMsg(`已复制 ${tag}`),
                () => useWorkbenchStore.getState().toastMsg("复制失败"),
              );
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                (e.currentTarget as HTMLElement).click();
              }
            }}
          >
            #{pane.serial}
          </span>
          <span
            className="pane-cwd"
            title={pane.cwd}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            {pane.cwd || "—"}
          </span>
        </span>
        <span className="ph-right">
          <button
            className="pane-icon-btn"
            type="button"
            title="历史命令（同 Shell 共享）"
            aria-label="历史命令"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setHistOpen((v) => !v);
              setShowSuggest(false);
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <polyline
                points="12 8 12 12 15 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            className="pane-icon-btn"
            type="button"
            title="清屏 (Ctrl+L)"
            aria-label="清屏"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const livePty = ptyId || getLiveTerm(pane.id)?.ptyId || null;
              if (realTerm && livePty) {
                void import("../../ipc/pty").then(({ ptyWrite }) => {
                  const isWin =
                    pane.shellKey === "ps" ||
                    pane.shellKey === "cmd" ||
                    pane.shellKey.startsWith("ps");
                  void ptyWrite(livePty, isWin ? "Clear-Host\r" : "clear\r");
                });
                window.dispatchEvent(
                  new CustomEvent("sw:clear-pane", { detail: { paneId: pane.id } }),
                );
              } else {
                clearPane(pane.id);
              }
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className="pane-close"
            type="button"
            title={leafCount <= 1 ? "至少保留一个窗格" : `关闭窗格 #${pane.serial}`}
            aria-label={`关闭窗格 #${pane.serial}`}
            disabled={leafCount <= 1}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closePane(pane.id);
            }}
          >
            ×
          </button>
        </span>
      </div>
      {histOpen && (
        <div
          className="pane-hist-pop"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="pane-hist-title">
            历史命令
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              {" "}
              · 同 Shell 共享
            </span>
          </div>
          {shellHistory.length === 0 && (
            <div className="pane-hist-empty">暂无历史</div>
          )}
          {shellHistory.map((h, i) => (
            <button
              key={h.cmd + i}
              type="button"
              className="pane-hist-item"
              onClick={() => {
                const live = getLiveTerm(pane.id);
                if (live?.ptyId && realTerm) {
                  void import("../../ipc/pty").then(({ ptyWrite }) => {
                    void ptyWrite(live.ptyId!, h.cmd);
                  });
                } else {
                  setDraft(pane.id, h.cmd);
                }
                setHistOpen(false);
              }}
            >
              <span className="pane-hist-cmd">{h.cmd}</span>
              <span className="pane-hist-meta">{h.count}×</span>
            </button>
          ))}
        </div>
      )}
      <div
        className="pane-body"
        ref={bodyRef}
        style={{ position: "relative", display: "flex", flexDirection: "column", minHeight: 0 }}
      >
        {realTerm ? (
          <XtermHost
            paneId={pane.id}
            shellKey={pane.shellKey}
            profileId={pane.profileId}
            cwd={settings.cwd || pane.cwd}
            active={active}
            onPtyId={setPtyId}
          />
        ) : (
          <>
            {pane.history.map((line, i) => (
              <div key={i} className={`term-line ${line.cls || "out"}`}>
                {line.text}
              </div>
            ))}
            <div className="prompt-row">
              <span className="prompt" dangerouslySetInnerHTML={{ __html: formatPrompt(pane) }} />
              <textarea
                ref={inputRef}
                className="cmd-input"
                rows={1}
                spellCheck={false}
                aria-label={`窗格 #${pane.serial} 命令输入`}
                value={pane.draft}
                onFocus={() => setActivePane(pane.id)}
                onChange={(e) => {
                  setDraft(pane.id, e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => {
                  if (showSuggest && suggestions.length) {
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSuggestIdx((i) => Math.max(0, i - 1));
                      return;
                    }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSuggestIdx((i) => Math.min(suggestions.length - 1, i + 1));
                      return;
                    }
                    if (e.key === "Tab") {
                      e.preventDefault();
                      acceptSuggest(false);
                      return;
                    }
                    if (e.key === "Escape") {
                      setShowSuggest(false);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (showSuggest && suggestions.length && e.ctrlKey) {
                      acceptSuggest(true);
                      return;
                    }
                    const raw = pane.draft;
                    if (raw.trim()) recordCommand(raw, pane.shellKey, settings.historyLimit);
                    runCommand(pane.id, raw);
                    return;
                  }
                  if (e.key === "ArrowUp" && !showSuggest) {
                    if (!pane.cmdHistory.length) return;
                    e.preventDefault();
                    historyNavigate(pane.id, "up");
                    return;
                  }
                  if (e.key === "ArrowDown" && !showSuggest) {
                    e.preventDefault();
                    historyNavigate(pane.id, "down");
                    return;
                  }
                  if (e.key === "l" && e.ctrlKey) {
                    e.preventDefault();
                    clearPane(pane.id);
                  }
                }}
              />
            </div>
            {showSuggest && suggestions.length > 0 && (
              <div
                className="cmd-suggest"
                style={{
                  position: "absolute",
                  left: 8,
                  right: 8,
                  bottom: 36,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "var(--shadow-panel)",
                  zIndex: 20,
                  maxHeight: 200,
                  overflow: "auto",
                  padding: 4,
                }}
              >
                {suggestions.map((item, i) => (
                  <button
                    key={item.cmd + i}
                    type="button"
                    className="shell-option"
                    style={{
                      background: i === suggestIdx ? "var(--surface-2)" : "transparent",
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSuggestIdx(i);
                      setDraft(pane.id, item.cmd);
                      setShowSuggest(false);
                    }}
                  >
                    <span className="so-text" style={{ flex: 1 }}>
                      <span
                        className="so-name"
                        style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
                      >
                        {item.cmd}
                      </span>
                    </span>
                    <span className="so-desc">
                      {item.source}
                      {item.count > 1 ? ` · ${item.count}×` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function formatPrompt(pane: LeafPane): string {
  // match prototype colored segments roughly
  if (pane.shellKey === "ps") {
    return `<span class="prompt-path">PS ${pane.cwd}</span><span class="prompt-sep">&gt; </span>`;
  }
  if (pane.shellKey === "cmd") {
    return `<span class="prompt-path">${pane.cwd}</span><span class="prompt-sep">&gt;</span>`;
  }
  if (pane.shellKey === "zsh") {
    return `<span class="prompt-path">dev@mac</span><span class="prompt-sep"> </span><span style="color:oklch(0.72 0.1 250)">~</span><span class="prompt-sep"> % </span>`;
  }
  return `<span class="prompt-path">dev@host</span><span class="prompt-sep">:</span><span style="color:oklch(0.72 0.1 250)">~</span><span class="prompt-sep">$ </span>`;
}

function SplitView({
  node,
  leafCount,
  activePaneId,
}: {
  node: SplitNode;
  leafCount: number;
  activePaneId: string | null;
}) {
  const setSplitRatio = useWorkbenchStore((s) => s.setSplitRatio);
  const gutterRef = useRef<HTMLDivElement>(null);

  const onPointerDown = (ev: React.PointerEvent) => {
    ev.preventDefault();
    const gutter = gutterRef.current;
    if (!gutter) return;
    const group = gutter.parentElement;
    if (!group) return;
    const vertical = node.dir === "v";
    const rect = group.getBoundingClientRect();
    const total = vertical ? rect.height : rect.width;
    if (total < 40) return;
    const start = vertical ? ev.clientY : ev.clientX;
    const startRatio = node.ratio;
    gutter.classList.add("dragging");

    const onMove = (e: PointerEvent) => {
      const delta = (vertical ? e.clientY : e.clientX) - start;
      let ratio = startRatio + delta / total;
      const minR = 100 / total;
      ratio = Math.max(minR, Math.min(1 - minR, ratio));
      setSplitRatio(node.id, ratio);
    };
    const onUp = () => {
      gutter.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className={`split-group split-${node.dir === "v" ? "v" : "h"}`}
      data-split-id={node.id}
    >
      <div className="split-child" style={{ flex: `${node.ratio} 1 0px` }}>
        <LayoutView
          key={node.a.type === "leaf" ? node.a.id : node.a.id}
          node={node.a}
          leafCount={leafCount}
          activePaneId={activePaneId}
        />
      </div>
      <div
        ref={gutterRef}
        className="split-gutter"
        onPointerDown={onPointerDown}
      />
      <div className="split-child" style={{ flex: `${1 - node.ratio} 1 0px` }}>
        <LayoutView
          key={node.b.type === "leaf" ? node.b.id : node.b.id}
          node={node.b}
          leafCount={leafCount}
          activePaneId={activePaneId}
        />
      </div>
    </div>
  );
}

export function LayoutView({
  node,
  leafCount,
  activePaneId,
}: {
  node: LayoutNode;
  leafCount: number;
  activePaneId: string | null;
}) {
  if (node.type === "leaf") {
    // Stable key by pane id so React remounts don't kill siblings on split
    return (
      <LeafView
        key={node.id}
        pane={node}
        leafCount={leafCount}
        active={node.id === activePaneId}
      />
    );
  }
  return (
    <SplitView
      key={node.id}
      node={node}
      leafCount={leafCount}
      activePaneId={activePaneId}
    />
  );
}

export function PanesHost() {
  const tab = useWorkbenchStore((s) => s.activeTab());
  const activePaneId = useWorkbenchStore((s) => s.activePaneId);
  if (!tab) return <div className="panes" id="panes" />;
  const leafCount = countLeaves(tab.layout);
  return (
    <div className="panes" id="panes">
      <LayoutView node={tab.layout} leafCount={leafCount} activePaneId={activePaneId} />
    </div>
  );
}
