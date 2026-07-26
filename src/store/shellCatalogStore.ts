import { create } from "zustand";
import { shellScan } from "../ipc/pty";
import { isTauri } from "../lib/window";
import {
  type ScannedShellProfile,
  browserFallbackProfiles,
  mapScanRow,
} from "../lib/shellProfile";
import { useSettingsStore } from "./settingsStore";

type ShellCatalogState = {
  profiles: ScannedShellProfile[];
  loading: boolean;
  error: string | null;
  lastScanAt: number | null;
  scan: () => Promise<ScannedShellProfile[]>;
  ensureScanned: () => Promise<ScannedShellProfile[]>;
  getById: (id: string) => ScannedShellProfile | undefined;
  getByShellKey: (key: string) => ScannedShellProfile | undefined;
  defaultProfile: () => ScannedShellProfile | undefined;
};

export const useShellCatalogStore = create<ShellCatalogState>((set, get) => ({
  profiles: [],
  loading: false,
  error: null,
  lastScanAt: null,

  scan: async () => {
    set({ loading: true, error: null });
    try {
      if (!isTauri()) {
        const profiles = browserFallbackProfiles();
        set({ profiles, loading: false, lastScanAt: Date.now() });
        return profiles;
      }
      const rows = await shellScan();
      const profiles = rows
        .filter((r) => r.available)
        .map(mapScanRow);
      set({ profiles, loading: false, lastScanAt: Date.now(), error: null });
      return profiles;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // keep previous or fallback
      const fallback = get().profiles.length ? get().profiles : browserFallbackProfiles();
      set({
        profiles: fallback,
        loading: false,
        error: msg,
        lastScanAt: Date.now(),
      });
      return fallback;
    }
  },

  ensureScanned: async () => {
    const s = get();
    if (s.profiles.length && s.lastScanAt && Date.now() - s.lastScanAt < 60_000) {
      return s.profiles;
    }
    return get().scan();
  },

  getById: (id) => get().profiles.find((p) => p.id === id),

  getByShellKey: (key) =>
    get().profiles.find((p) => p.shellKey === key) ||
    get().profiles.find((p) => p.shellKey.startsWith(`${key}:`)),

  defaultProfile: () => {
    const list = get().profiles;
    if (!list.length) return undefined;
    // User's default shell (settings) wins; hardcoded priority is only a fallback
    const pref = useSettingsStore.getState().defaultShell?.trim();
    if (pref) {
      const hit =
        list.find((p) => p.shellKey === pref) ||
        list.find((p) => p.shellKey.startsWith(`${pref}:`)) ||
        list.find((p) => p.id === pref);
      if (hit) return hit;
    }
    // prefer pwsh, then powershell, then first
    return (
      list.find((p) => p.id === "ps-pwsh") ||
      list.find((p) => p.shellKey === "ps") ||
      list.find((p) => p.shellKey === "zsh") ||
      list.find((p) => p.shellKey === "bash") ||
      list[0]
    );
  },
}));
