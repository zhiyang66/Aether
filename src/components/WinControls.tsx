import { useWorkbenchStore } from "../store/workbenchStore";
import { winMinimize, winToggleMaximize } from "../lib/window";

export function WinControls() {
  const maximized = useWorkbenchStore((s) => s.windowMaximized);
  const setMaximized = useWorkbenchStore((s) => s.setWindowMaximized);
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);
  const requestAppClose = useWorkbenchStore((s) => s.requestAppClose);

  return (
    <div className="win-controls">
      <button
        className="win-btn"
        type="button"
        title="最小化"
        aria-label="最小化"
        onClick={(e) => {
          e.stopPropagation();
          void winMinimize();
        }}
      >
        <svg viewBox="0 0 10 10">
          <line x1="1" y1="5" x2="9" y2="5" />
        </svg>
      </button>
      <button
        className="win-btn"
        type="button"
        title={maximized ? "向下还原" : "最大化"}
        aria-label={maximized ? "向下还原" : "最大化"}
        onClick={async (e) => {
          e.stopPropagation();
          const next = await winToggleMaximize();
          if (typeof next === "boolean") setMaximized(next);
          else setMaximized(!maximized);
          toastMsg(maximized ? "已还原为窗口" : "已最大化");
        }}
      >
        <svg className="max-icon normal" viewBox="0 0 10 10">
          <rect x="1.2" y="1.2" width="7.6" height="7.6" />
        </svg>
        <svg className="max-icon restore" viewBox="0 0 10 10">
          <rect x="2.5" y="0.8" width="6.2" height="6.2" />
          <polyline points="0.8,2.8 0.8,9.2 7.2,9.2" />
        </svg>
      </button>
      <button
        className="win-btn close"
        type="button"
        title="关闭"
        aria-label="关闭"
        onClick={(e) => {
          e.stopPropagation();
          requestAppClose();
        }}
      >
        <svg viewBox="0 0 10 10">
          <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
          <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
        </svg>
      </button>
    </div>
  );
}
