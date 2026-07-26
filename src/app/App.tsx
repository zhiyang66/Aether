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
