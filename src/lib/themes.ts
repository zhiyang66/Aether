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

