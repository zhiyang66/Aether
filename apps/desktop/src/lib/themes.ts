/** Named appearance presets */

export type ThemePresetId = "cyan" | "green" | "violet" | "amber" | "slate";

export type ThemePreset = {
  id: ThemePresetId;
  label: string;
  accentHue: number;
  termBg: string;
  termFg: string;
  termCursor: string;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "cyan",
    label: "青 · 默认",
    accentHue: 195,
    termBg: "#0f1115",
    termFg: "#c8e6c9",
    termCursor: "#7dd3c0",
  },
  {
    id: "green",
    label: "绿 · 终端",
    accentHue: 145,
    termBg: "#0c120e",
    termFg: "#b8f0c8",
    termCursor: "#5eead4",
  },
  {
    id: "violet",
    label: "紫 · 夜航",
    accentHue: 300,
    termBg: "#121018",
    termFg: "#e0d4f7",
    termCursor: "#c4b5fd",
  },
  {
    id: "amber",
    label: "琥珀 · 暖屏",
    accentHue: 55,
    termBg: "#14120c",
    termFg: "#f5e6c8",
    termCursor: "#fbbf24",
  },
  {
    id: "slate",
    label: "灰 · 冷静",
    accentHue: 250,
    termBg: "#0e1116",
    termFg: "#d1d5db",
    termCursor: "#93c5fd",
  },
];

export function getPreset(id: string | undefined): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) || THEME_PRESETS[0];
}

/** @deprecated use applyThemeCssVars from windowMaterial — kept for callers */
export function applyThemePreset(preset: ThemePreset) {
  const root = document.documentElement;
  root.style.setProperty("--accent", `oklch(0.72 0.14 ${preset.accentHue})`);
  root.style.setProperty("--accent-dim", `oklch(0.45 0.08 ${preset.accentHue})`);
  root.style.setProperty("--term-prompt", `oklch(0.78 0.14 ${preset.accentHue})`);
  root.style.setProperty("--sw-term-bg", preset.termBg);
  root.style.setProperty("--sw-term-fg", preset.termFg);
  root.style.setProperty("--sw-term-cursor", preset.termCursor);
  // also tint surfaces so theme is visible
  const chroma = preset.accentHue === 250 ? 0.008 : 0.014;
  const h = preset.accentHue;
  root.style.setProperty("--bg", `oklch(0.16 ${chroma} ${h})`);
  root.style.setProperty("--surface", `oklch(0.20 ${chroma} ${h})`);
  root.style.setProperty("--surface-2", `oklch(0.24 ${chroma} ${h})`);
  root.style.setProperty("--border", `oklch(0.32 ${chroma * 1.1} ${h})`);
  root.style.setProperty("--tab-active", `oklch(0.22 ${chroma} ${h})`);
  root.style.setProperty("--term-bg", preset.termBg);
  root.style.setProperty("--term-fg", preset.termFg);
}
