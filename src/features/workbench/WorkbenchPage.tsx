import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Titlebar } from "./Titlebar";
import { Tabbar } from "./Tabbar";
import { PanesHost } from "./TerminalPane";
import { AiPanel } from "./AiPanel";
import { Toast } from "../../components/Toast";
import { CommandPalette } from "../../components/CommandPalette";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useSettingsStore } from "../../store/settingsStore";
import { collectLeaves } from "../../lib/layout";
import "../../styles/workbench.css";
import "../../styles/product.css";

export function WorkbenchPage() {
  const nav = useNavigate();
  const bootstrap = useWorkbenchStore((s) => s.bootstrap);
  const tabs = useWorkbenchStore((s) => s.tabs);
  const maximized = useWorkbenchStore((s) => s.windowMaximized);
  const setAiOpen = useWorkbenchStore((s) => s.setAiOpen);
  const addPane = useWorkbenchStore((s) => s.addPane);
  const closeTab = useWorkbenchStore((s) => s.closeTab);
  const clearPane = useWorkbenchStore((s) => s.clearPane);
  const aiOpen = useWorkbenchStore((s) => s.aiOpen);
  const setShellMenuOpen = useWorkbenchStore((s) => s.setShellMenuOpen);
  const activeTabId = useWorkbenchStore((s) => s.activeTabId);
  const closePane = useWorkbenchStore((s) => s.closePane);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const settings = useSettingsStore();
  const welcomeDismissed = useSettingsStore((s) => s.welcomeDismissed);
  const patchSettings = useSettingsStore((s) => s.patch);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const focusMaximized = useWorkbenchStore((s) => s.focusMaximized);
  const toggleFocusMaximize = useWorkbenchStore((s) => s.toggleFocusMaximize);

  useEffect(() => {
    if (tabs.length === 0) bootstrap();
  }, [bootstrap, tabs.length]);

  useEffect(() => {
    const openPal = () => setPaletteOpen(true);
    window.addEventListener("sw:open-palette", openPal);
    return () => window.removeEventListener("sw:open-palette", openPal);
  }, []);

  useEffect(() => {
    // Apply settings-driven AI open only once after settings load
    if (settings.aiOnStart && settings.aiEnabled) {
      setAiOpen(true);
    } else if (!settings.aiEnabled) {
      setAiOpen(false);
    }
  }, [settings.aiEnabled, settings.aiOnStart, setAiOpen]);

  useEffect(() => {
    document.documentElement.style.setProperty("--term-font-size", `${fontSize}px`);
  }, [fontSize]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      // Command palette
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      if (paletteOpen) return;

      if (mod && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setShellMenuOpen(true);
      }
      if (mod && e.key.toLowerCase() === "w" && !e.shiftKey) {
        if (inInput && !target?.classList.contains("cmd-input")) return;
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        const p = useWorkbenchStore.getState().activePane();
        if (p) closePane(p.id);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        useWorkbenchStore.getState().setAiOpen(!useWorkbenchStore.getState().aiOpen);
      }
      if (mod && e.key.toLowerCase() === "l" && !inInput) {
        e.preventDefault();
        clearPane();
      }
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        addPane("h");
      }
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        addPane("v");
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        nav("/settings");
      }
      // Focus next/prev pane: Ctrl+Alt+Arrow
      if (mod && e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        const st = useWorkbenchStore.getState();
        const tab = st.activeTab();
        if (!tab) return;
        const leaves = collectLeaves(tab.layout);
        if (leaves.length < 2) return;
        const cur = leaves.findIndex((l) => l.id === st.activePaneId);
        const next =
          e.key === "ArrowRight"
            ? leaves[(cur + 1) % leaves.length]
            : leaves[(cur - 1 + leaves.length) % leaves.length];
        st.setActivePane(next.id);
      }
      // Maximize focus pane
      if (mod && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        useWorkbenchStore.getState().toggleFocusMaximize();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeTabId,
    addPane,
    closeTab,
    closePane,
    setShellMenuOpen,
    clearPane,
    nav,
    paletteOpen,
  ]);

  return (
    <div className={`app${maximized ? "" : " windowed"}`} id="app">
      <Titlebar />
      {!welcomeDismissed && (
        <div className="welcome-banner">
          <span>
            欢迎使用 Aether · 分屏可对 Agent 说「左右分屏」或 Alt+Shift+D/E，Agent 可用 #N / 标签 T1 指定，
            <kbd style={{ margin: "0 4px" }}>Ctrl+Shift+P</kbd>
            打开命令面板
            {focusMaximized ? " · 当前焦点窗格已最大化" : ""}
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            {focusMaximized && (
              <button type="button" onClick={() => toggleFocusMaximize()}>
                还原分屏
              </button>
            )}
            <button type="button" onClick={() => patchSettings({ welcomeDismissed: true })}>
              知道了
            </button>
          </span>
        </div>
      )}
      <div className="workspace">
        <div className="main-col">
          <Tabbar />
          <PanesHost />
        </div>
        {settings.aiEnabled && aiOpen && <AiPanel />}
      </div>
      <Toast />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
