import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../lib/window";
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

  accentHue: number;
  themePreset: string;
  material: WindowMaterial;
  /** Overall UI opacity 40–100 when using mica/acrylic */
  uiOpacity: number;
  fontFamily: string;
  fontSize: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
  /**
   * Terminal glyph renderer:
   * - auto (default): try WebGL, fall back to Canvas
   * - webgl: force WebGL (still falls back if context fails)
   * - canvas: force Canvas 2D
   */
  termRenderer: "auto" | "webgl" | "canvas";
  /**
   * Window min/max/close chrome side:
   * - auto (default): macOS → left traffic lights; Windows/Linux → right buttons
   * - left / right: force that side (and matching visual style)
   */
  windowControlsSide: "auto" | "left" | "right";
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
  /** Pull authoritative settings from ~/.aether/config.json (desktop only). */
  loadFromDisk: () => Promise<void>;
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
  | "loadFromDisk"
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
  accentHue: 195,
  themePreset: "cyan",
  material: "solid" as const,
  uiOpacity: 100,
  fontFamily: "Cascadia Code",
  fontSize: 13,
  cursorStyle: "bar",
  cursorBlink: true,
  termRenderer: "auto",
  windowControlsSide: "auto",
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

/** Method keys that must never be persisted. */
type SettingsData = Omit<
  SettingsState,
  | "load"
  | "loadFromDisk"
  | "save"
  | "patch"
  | "reset"
  | "applyAccent"
  | "applyPreset"
  | "previewOpacity"
>;

/** Strip store methods → the plain, persistable settings object. */
function serializeState(s: SettingsState): SettingsData {
  const {
    load: _l,
    loadFromDisk: _lfd,
    save: _s,
    patch: _p,
    reset: _r,
    applyAccent: _a,
    applyPreset: _ap,
    previewOpacity: _po,
    ...data
  } = s;
  return { ...data, material: "solid" };
}

/**
 * Merge a loaded config object over defaults — file values win, unknown/missing
 * fields fall back to defaults, and material is always forced solid (the UI no
 * longer exposes mica/acrylic). Pure; used for both localStorage and the
 * authoritative ~/.aether/config.json.
 */
export function mergeLoadedConfig(
  fileObj: Partial<SettingsState>,
): SettingsData {
  return { ...defaults(), ...fileObj, material: "solid" };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaults(),

  load: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SettingsState>;
        set(mergeLoadedConfig(parsed));
      }
    } catch {
      /* ignore */
    }
    get().applyAccent();
  },

  /**
   * ~/.aether/config.json is the authoritative settings source. On the desktop:
   * if the file exists, it wins over localStorage (mirrored back for parity); if
   * it does not (first run / unreadable), seed it from the current settings.
   * No-op in a browser (localStorage only).
   */
  loadFromDisk: async () => {
    if (!isTauri()) return;
    let raw: string | null = null;
    try {
      raw = await invoke<string | null>("aether_config_read");
    } catch {
      return;
    }
    if (raw) {
      try {
        const fileObj = JSON.parse(raw) as Partial<SettingsState>;
        set(mergeLoadedConfig(fileObj));
        // Mirror into localStorage so export / offline load stay in parity.
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(serializeState(get())),
        );
        get().applyAccent();
        return;
      } catch {
        /* unparseable → fall through and re-seed */
      }
    }
    get().save(); // seed config.json from current state
  },

  save: () => {
    const json = JSON.stringify(serializeState(get()));
    localStorage.setItem(STORAGE_KEY, json);
    if (isTauri()) {
      void invoke("aether_config_write", { contents: json }).catch(() => {
        /* localStorage is the fallback; ignore disk write failures */
      });
    }
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

/** Fields that must never leave the machine in an exported settings file. */
const SECRET_SETTING_KEYS = ["aiApiKey"] as const;

/**
 * Serialize persisted settings for export with all secret fields removed.
 * Both the Settings page and the command palette export through this so a
 * shared settings JSON can never leak the API key.
 */
export function exportSettingsJson(): string {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    obj = {};
  }
  for (const k of SECRET_SETTING_KEYS) delete obj[k];
  return JSON.stringify(obj, null, 2);
}
