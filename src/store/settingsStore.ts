import { create } from "zustand";
import { defaultShellForPlatform, platformLabel } from "../lib/shells";
import { getPreset } from "../lib/themes";
import { loadSnapshotStore, saveSnapshotStore } from "../lib/outputSnapshot";
import {
  applyThemeCssVars,
  applyWindowMaterial,
  type WindowMaterial,
} from "../lib/windowMaterial";

export type SettingsState = {
  /** catalog shell key, e.g. ps | bash | wsl:Ubuntu-24.04 */
  defaultShell: string;
  restoreSession: boolean;
  aiOnStart: boolean;
  lastTabAction: "close" | "new";
  confirmMultiTabClose: boolean;
  copyWithPrompt: boolean;

  cwd: string;
  startupCmd: string;
  /** OSC 133/7 shell integration at spawn (command blocks) */
  shellIntegration: boolean;
  /** Notify when a long command finishes while the window is unfocused */
  notifyOnLongCommand: boolean;
  notifyThresholdSec: number;
  profiles: { id: string; name: string; path: string; shellKey: string }[];

  accentHue: number;
  themePreset: string;
  material: WindowMaterial;
  /** Overall UI opacity 40–100 when using mica/acrylic */
  uiOpacity: number;
  fontFamily: string;
  fontSize: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
  welcomeDismissed: boolean;

  aiEnabled: boolean;
  aiProvider: "openai-compat" | "anthropic" | "custom";
  aiEndpoint: string;
  aiApiKey: string;
  aiDefaultModelId: string;
  contextScope: "focus" | "activeTab" | "allTabs";
  includeDraft: boolean;
  contextLines: number;
  confirmDanger: boolean;
  execMode: "insert" | "confirm" | "auto";
  agentCurrentTabOnly: boolean;
  restoreAgentSession: boolean;

  suggestEnabled: boolean;
  suggestHistory: boolean;
  suggestFrequent: boolean;
  suggestFuzzy: boolean;
  suggestMax: number;
  historyLimit: number;
  historyByShell: boolean;
  suggestAccept: "insert" | "run";

  outputSnapshotEnabled: boolean;
  outputSnapshotLines: number;
  /** URL to version.json for update check; empty = disabled */
  updateFeedUrl: string;
  /** Show agent thinking / reasoning UI (composer toggle) */
  showThinking: boolean;
  /** 1.0: inject AETHER.md project context (found upward from pane cwd) */
  projectContext: boolean;

  load: () => void;
  save: () => void;
  patch: (p: Partial<SettingsState>) => void;
  reset: () => void;
  applyAccent: () => void;
  applyPreset: (id: string) => void;
  /** Live-preview opacity while dragging (does not write localStorage). */
  previewOpacity: (opacityPercent: number) => void;
};

const defaults = (): Omit<
  SettingsState,
  | "load"
  | "save"
  | "patch"
  | "reset"
  | "applyAccent"
  | "applyPreset"
  | "previewOpacity"
> => ({
  defaultShell: defaultShellForPlatform(),
  restoreSession: true,
  aiOnStart: true,
  lastTabAction: "new",
  confirmMultiTabClose: true,
  copyWithPrompt: false,
  cwd: "",
  startupCmd: "",
  shellIntegration: true,
  notifyOnLongCommand: true,
  notifyThresholdSec: 15,
  profiles: [],
  accentHue: 195,
  themePreset: "cyan",
  material: "solid" as const,
  uiOpacity: 100,
  fontFamily: "Cascadia Code",
  fontSize: 13,
  cursorStyle: "bar",
  cursorBlink: true,
  welcomeDismissed: false,
  aiEnabled: true,
  aiProvider: "openai-compat",
  aiEndpoint: "",
  aiApiKey: "",
  aiDefaultModelId: "",
  // Prefer focus to limit tokens / privacy surface (user can widen in settings)
  contextScope: "focus",
  includeDraft: true,
  contextLines: 40,
  confirmDanger: true,
  execMode: "confirm",
  agentCurrentTabOnly: true,
  restoreAgentSession: true,
  suggestEnabled: true,
  suggestHistory: true,
  suggestFrequent: true,
  suggestFuzzy: false,
  suggestMax: 8,
  historyLimit: 5000,
  historyByShell: true,
  suggestAccept: "insert",
  outputSnapshotEnabled: false,
  outputSnapshotLines: 200,
  updateFeedUrl: "",
  showThinking: false,
  projectContext: true,
});

const STORAGE_KEY = "sw-settings-v1";

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaults(),

  load: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SettingsState>;
        // Force solid material (UI no longer exposes mica/acrylic)
        set({
          ...defaults(),
          ...parsed,
          material: "solid",
        });
      }
    } catch {
      /* ignore */
    }
    get().applyAccent();
  },

  save: () => {
    const s = get();
    const {
      load: _l,
      save: _s,
      patch: _p,
      reset: _r,
      applyAccent: _a,
      applyPreset: _ap,
      previewOpacity: _po,
      ...data
    } = s as SettingsState & { previewOpacity?: unknown };
    data.material = "solid";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    get().applyAccent();
  },

  patch: (p) => {
    // Live-update store; caller decides whether to save (footer 保存)
    // Except theme preset / most settings still auto-save for convenience —
    // uiOpacity is special: use previewOpacity for drag, save() to commit.
    if ("uiOpacity" in p && Object.keys(p).length === 1) {
      set(p);
      get().previewOpacity(p.uiOpacity ?? 100);
      return;
    }
    set({ ...p, material: "solid" });
    get().save();
  },

  reset: () => {
    set(defaults());
    get().save();
  },

  /** Live opacity without writing localStorage */
  previewOpacity: (opacityPercent: number) => {
    const s = get();
    const preset = getPreset(s.themePreset);
    applyThemeCssVars({
      accentHue: s.accentHue,
      termBg: preset.termBg,
      termFg: preset.termFg,
      termCursor: preset.termCursor,
      material: "solid",
      opacityPercent,
    });
  },

  applyAccent: () => {
    const s = get();
    const preset = getPreset(s.themePreset);
    applyThemeCssVars({
      accentHue: s.accentHue,
      termBg: preset.termBg,
      termFg: preset.termFg,
      termCursor: preset.termCursor,
      material: "solid",
      opacityPercent: s.uiOpacity ?? 100,
    });
    const snap = loadSnapshotStore();
    snap.enabled = s.outputSnapshotEnabled;
    snap.maxLines = s.outputSnapshotLines;
    saveSnapshotStore(snap);
    window.setTimeout(() => {
      void applyWindowMaterial("solid", s.uiOpacity ?? 100);
    }, 0);
  },

  applyPreset: (id) => {
    const preset = getPreset(id);
    set({
      themePreset: preset.id,
      accentHue: preset.accentHue,
      material: "solid",
    });
    get().save();
  },
}));

export { platformLabel };
