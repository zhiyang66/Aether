import { Link } from "react-router-dom";
import { WinControls } from "../../components/WinControls";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useSettingsStore } from "../../store/settingsStore";
import { winToggleMaximize } from "../../lib/window";
import { resolveWindowControlsSide } from "../../lib/platform";
import logoUrl from "../../assets/logo.png";

export function Titlebar() {
  const aiOpen = useWorkbenchStore((s) => s.aiOpen);
  const setAiOpen = useWorkbenchStore((s) => s.setAiOpen);
  const setWindowMaximized = useWorkbenchStore((s) => s.setWindowMaximized);
  const maximized = useWorkbenchStore((s) => s.windowMaximized);
  const sidePref = useSettingsStore((s) => s.windowControlsSide);
  const side = resolveWindowControlsSide(sidePref);
  const leftChrome = side === "left";

  const brand = (
    <>
      <div className="app-icon" aria-hidden="true">
        <img src={logoUrl} alt="" draggable={false} />
      </div>
      <div className="app-title" data-tauri-drag-region>
        <strong>Aether</strong>
      </div>
    </>
  );

  const actions = (
    <div className="titlebar-center">
      <button
        className={`icon-btn${aiOpen ? " active" : ""}`}
        type="button"
        title="Agent"
        aria-label="切换 Agent 面板"
        onClick={() => setAiOpen(!aiOpen)}
      >
        <svg className="agent-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="7" width="14" height="11" rx="3" />
          <circle cx="9.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <path d="M9 15.2c.8.7 1.6 1 3 1s2.2-.3 3-1" />
          <path d="M12 7V4.5" />
          <circle cx="12" cy="3.5" r="1" fill="currentColor" stroke="none" />
          <path d="M3.5 11.5h1.5M19 11.5h1.5" />
        </svg>
      </button>
      <Link className="titlebar-settings" to="/settings" title="设置" aria-label="打开设置">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </Link>
    </div>
  );

  return (
    <header
      className={`titlebar${leftChrome ? " is-mac" : " is-win"}`}
      id="titlebar"
      data-tauri-drag-region
      onDoubleClick={async (e) => {
        const t = e.target as HTMLElement;
        if (t.closest(".win-btn, .traffic-btn, .icon-btn, a, button")) return;
        const next = await winToggleMaximize();
        if (typeof next === "boolean") setWindowMaximized(next);
        else setWindowMaximized(!maximized);
      }}
    >
      {leftChrome ? (
        <>
          {/*
            Three-zone layout so the title is truly centered in the window:
            [ traffic + spacer ]  |  [ brand ]  |  [ actions + spacer ]
            Side columns share the same flex basis so brand stays mid-window.
          */}
          <div className="titlebar-mac-side titlebar-mac-side-left">
            <WinControls side="left" />
            <div className="titlebar-drag-fill" data-tauri-drag-region aria-hidden="true" />
          </div>
          <div className="titlebar-mac-center" data-tauri-drag-region>
            {brand}
          </div>
          <div className="titlebar-mac-side titlebar-mac-side-right">
            <div className="titlebar-drag-fill" data-tauri-drag-region aria-hidden="true" />
            {actions}
          </div>
        </>
      ) : (
        <>
          <div className="titlebar-left" data-tauri-drag-region>
            {brand}
          </div>
          <div className="titlebar-drag-fill" data-tauri-drag-region aria-hidden="true" />
          {actions}
          <WinControls side="right" />
        </>
      )}
    </header>
  );
}
