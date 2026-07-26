import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { WorkbenchPage } from "../features/workbench/WorkbenchPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { AppContextMenu } from "../components/AppContextMenu";
import { AppDialogHost } from "../components/AppDialog";
import { useSettingsStore } from "../store/settingsStore";
import { useShellCatalogStore } from "../store/shellCatalogStore";
import { refreshSkills } from "../lib/agentSkills";
import "../styles/tokens.css";
import "../styles/xterm-bridge.css";
import "../styles/product.css";

export default function App() {
  const load = useSettingsStore((s) => s.load);
  const loadFromDisk = useSettingsStore((s) => s.loadFromDisk);
  const scanShells = useShellCatalogStore((s) => s.scan);

  useEffect(() => {
    load(); // fast, synchronous localStorage read (avoids blank flash)
    void loadFromDisk(); // authoritative ~/.aether/config.json overrides
    void refreshSkills(); // warm the skill cache (picks up user-added skills)
    void scanShells();
  }, [load, loadFromDisk, scanShells]);

  // Suppress webview/browser shortcuts the app doesn't use (Ctrl+P print,
  // Ctrl+S save-page, Ctrl+F find bar, Ctrl+O/J/U/G). This is a React SPA in a
  // webview, so these would otherwise pop the browser's own UI. preventDefault
  // only cancels the browser's action — the terminal still receives the key
  // (xterm's own keydown handler runs before this bubble listener), so shell
  // bindings like Ctrl+F (forward-char) / Ctrl+P (history) keep working.
  useEffect(() => {
    const BLOCK = new Set(["p", "s", "o", "j", "u", "g", "f"]);
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey || e.shiftKey) return;
      if (BLOCK.has(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<WorkbenchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <AppContextMenu />
        <AppDialogHost />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
