import { useEffect, useState } from "react";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { countLeaves, shellMeta } from "../../lib/layout";
import { formatDuration, lastBlock, onBlocksChanged } from "../../lib/commandBlocks";

export function Statusbar({ mock, aiOpen }: { mock: boolean; aiOpen: boolean }) {
  const tab = useWorkbenchStore((s) => s.activeTab());
  const pane = useWorkbenchStore((s) => s.activePane());
  const maximized = useWorkbenchStore((s) => s.windowMaximized);
  const [, setBlockTick] = useState(0);

  useEffect(() => onBlocksChanged(() => setBlockTick((v) => v + 1)), []);

  const shell = pane ? shellMeta(pane.shellKey) : null;
  const n = tab ? countLeaves(tab.layout) : 0;
  const blk = pane ? lastBlock(pane.id) : undefined;

  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className="status-item">
          <span className="status-dot" />{" "}
          {mock ? "模拟 Shell" : "已连接本机 Shell"}
        </span>
        <span className={`status-pill${mock ? " warn" : " ok"}`}>
          {mock ? "MOCK" : pane?.ptyId ? "PTY" : "…"}
        </span>
        <span className="status-item">{shell?.name ?? "—"}</span>
        <span className="status-item">{pane?.cwd ?? "—"}</span>
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
        <span className="status-item">{aiOpen ? "Agent 开" : "Agent 关"}</span>
        <span className="status-item">{maximized ? "最大化" : "窗口化"}</span>
        <span className="status-item">
          {n <= 1 ? "1 窗格" : `${n} 窗格 · 树状分屏`}
        </span>
        <span className="status-item">焦点 #{pane?.serial ?? "—"}</span>
        <span className="status-item">UTF-8</span>
        <span className="status-item" title="Ctrl+Shift+P 命令面板">
          ⌘P
        </span>
      </div>
    </footer>
  );
}
