import { useEffect, useState } from "react";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { shellMeta } from "../../lib/layout";
import { formatDuration, lastBlock, onBlocksChanged } from "../../lib/commandBlocks";
import {
  getTermRendererLive,
  onTermRendererLive,
  termRendererBadge,
  type TermRendererLive,
} from "../../lib/termRenderer";

/**
 * Compact status bar — high-signal items only.
 * Keeps T{tab}:#{pane} so Agent/user share the same pane ref language.
 */
export function Statusbar({ mock }: { mock: boolean; aiOpen?: boolean }) {
  const tabs = useWorkbenchStore((s) => s.tabs);
  const activeTabId = useWorkbenchStore((s) => s.activeTabId);
  const pane = useWorkbenchStore((s) => s.activePane());
  const broadcastPanes = useWorkbenchStore((s) => s.broadcastPanes);
  const clearBroadcast = useWorkbenchStore((s) => s.clearBroadcast);
  const [, setBlockTick] = useState(0);
  const [renderer, setRenderer] = useState<TermRendererLive>(() => getTermRendererLive());

  useEffect(() => onBlocksChanged(() => setBlockTick((v) => v + 1)), []);
  useEffect(() => onTermRendererLive(setRenderer), []);

  const shell = pane ? shellMeta(pane.shellKey) : null;
  const blk = pane ? lastBlock(pane.id) : undefined;
  const gpu = termRendererBadge(renderer);

  const tabIdx = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeTabId),
  );
  const tabRef = tabs.length ? `T${tabIdx + 1}` : "T—";
  const paneRef = pane ? `${tabRef}:#${pane.serial}` : tabRef;
  const tabTitle = tabs[tabIdx]?.title;

  const cwd = pane?.cwd || "";
  const cwdShort =
    cwd.length > 42 ? `…${cwd.slice(-40).replace(/^[/\\]/, "")}` : cwd || "—";

  return (
    <footer className="statusbar">
      <div className="status-left">
        {mock && (
          <span className="status-pill warn" title="浏览器模拟终端（无本机 PTY）">
            MOCK
          </span>
        )}
        <span
          className={`status-pill${gpu.kind === "ok" ? " ok" : gpu.kind === "warn" ? " warn" : ""}`}
          title={gpu.title}
        >
          {gpu.label}
        </span>
        <span
          className="status-item status-ref"
          title={
            tabTitle
              ? `焦点 ${paneRef} · ${tabTitle}${shell ? ` · ${shell.name}` : ""}`
              : `焦点 ${paneRef}`
          }
        >
          {paneRef}
        </span>
        {shell && (
          <span className="status-item" title={shell.name}>
            {shell.short || shell.name}
          </span>
        )}
        <span className="status-item status-cwd" title={cwd || undefined}>
          {cwdShort}
        </span>
        {blk && (
          <span
            className={`status-pill${
              blk.running ? "" : blk.exitCode ? " warn" : " ok"
            }`}
            title={blk.command || "最近命令"}
          >
            {blk.running
              ? "运行中…"
              : `exit ${blk.exitCode ?? "?"} · ${formatDuration((blk.endedAt ?? blk.startedAt) - blk.startedAt)}`}
          </span>
        )}
      </div>
      <div className="status-right">
        {broadcastPanes.length >= 2 && (
          <button
            type="button"
            className="status-pill warn"
            style={{ cursor: "pointer", border: "none", font: "inherit" }}
            title="点击退出广播模式"
            onClick={() => clearBroadcast()}
          >
            广播 · {broadcastPanes.length}
          </button>
        )}
      </div>
    </footer>
  );
}
