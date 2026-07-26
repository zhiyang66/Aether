import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./window";

export type WindowMaterial = "mica" | "acrylic" | "solid";

let lastMaterial: WindowMaterial | null = null;
let lastOpacity: number | null = null;
let applying = false;

/**
 * Apply material + overall UI opacity.
 *
 * Opacity is **true window transparency** (see-through to desktop/apps below),
 * NOT CSS filter brightness. Surfaces use oklch alpha; window is transparent.
 *
 * - solid: translucent solid chrome (alpha from opacity)
 * - mica/acrylic: OS backdrop effect + translucent chrome
 */
export async function applyWindowMaterial(
  material: WindowMaterial,
  opacityPercent = 100,
): Promise<void> {
  const opacity = Math.min(100, Math.max(40, Math.round(opacityPercent)));
  if (applying) {
    lastMaterial = material;
    lastOpacity = opacity;
    return;
  }
  if (lastMaterial === material && lastOpacity === opacity) return;
  lastMaterial = material;
  lastOpacity = opacity;

  const root = document.documentElement;
  root.dataset.material = material;
  root.style.setProperty("--ui-opacity", String(opacity / 100));

  if (!isTauri()) return;

  applying = true;
  try {
    const win = getCurrentWindow();
    // Allow see-through when below 100%
    try {
      // Color: [r, g, b, a] 0–255
      await win.setBackgroundColor(
        opacity >= 100 ? [26, 28, 32, 255] : [0, 0, 0, 0],
      );
    } catch {
      /* setBackgroundColor may be unavailable on some platforms */
    }

    if (material === "solid") {
      try {
        await win.clearEffects();
      } catch {
        /* ignore */
      }
    } else {
      const effects =
        material === "mica"
          ? [Effect.Mica, Effect.Acrylic, Effect.Blur]
          : [Effect.Acrylic, Effect.Blur, Effect.Mica];
      try {
        await win.setEffects({ effects });
      } catch {
        try {
          await win.clearEffects();
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    applying = false;
    if (lastMaterial !== material || lastOpacity !== opacity) {
      const m = lastMaterial ?? material;
      const o = lastOpacity ?? opacity;
      lastMaterial = null;
      lastOpacity = null;
      void applyWindowMaterial(m, o);
    }
  }
}

/** #RRGGBB or #RGB → rgba() with alpha (for xterm + CSS that need real alpha). */
export function colorWithAlpha(color: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  const c = color.trim();
  if (c.startsWith("rgba(") || c.startsWith("oklch(")) {
    // already has alpha form — best-effort replace trailing )
    if (c.startsWith("oklch(") && !c.includes("/")) {
      return c.replace(/\)$/, ` / ${a})`);
    }
    return c;
  }
  let hex = c.startsWith("#") ? c.slice(1) : c;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (hex.length !== 6 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return c;
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function applyThemeCssVars(opts: {
  accentHue: number;
  termBg: string;
  termFg: string;
  termCursor: string;
  material: WindowMaterial;
  opacityPercent: number;
}) {
  const root = document.documentElement;
  const { accentHue, termBg, termFg, termCursor, material, opacityPercent } = opts;
  const op = Math.min(100, Math.max(40, opacityPercent)) / 100;

  root.style.setProperty("--accent", `oklch(0.72 0.14 ${accentHue})`);
  root.style.setProperty("--accent-dim", `oklch(0.45 0.08 ${accentHue})`);
  root.style.setProperty("--term-prompt", `oklch(0.78 0.14 ${accentHue})`);
  root.style.setProperty("--sw-term-bg", termBg);
  root.style.setProperty("--sw-term-fg", termFg);
  root.style.setProperty("--sw-term-cursor", termCursor);
  root.style.setProperty("--ui-opacity", String(op));
  root.dataset.material = material;

  // IMPORTANT: use the *same* alpha for every surface token.
  // Do not use op+0.04 on surface — that made cards/side regions look more solid.
  // Stacking is avoided in CSS: .app is transparent; each chrome region paints once.
  const chroma = accentHue === 250 ? 0.008 : 0.014;
  const a = op;
  root.style.setProperty("--bg", `oklch(0.16 ${chroma} ${accentHue} / ${a})`);
  root.style.setProperty("--surface", `oklch(0.20 ${chroma} ${accentHue} / ${a})`);
  root.style.setProperty("--surface-2", `oklch(0.24 ${chroma} ${accentHue} / ${a})`);
  // Borders: soft hairlines (low contrast, slight alpha) — not hard chalk lines
  const borderA = a >= 0.98 ? 0.55 : Math.max(0.22, Math.min(0.5, a * 0.42));
  const borderSubtleA = a >= 0.98 ? 0.35 : Math.max(0.14, Math.min(0.32, a * 0.28));
  root.style.setProperty(
    "--border",
    `oklch(0.62 ${chroma * 0.6} ${accentHue} / ${borderA})`,
  );
  root.style.setProperty(
    "--border-subtle",
    `oklch(0.58 ${chroma * 0.5} ${accentHue} / ${borderSubtleA})`,
  );
  root.style.setProperty(
    "--border-strong",
    `oklch(0.72 ${chroma * 0.7} ${accentHue} / ${Math.min(0.65, borderA + 0.12)})`,
  );
  // Control chips / active tabs: brighter fill so labels stay readable on glass chrome
  // Alpha scales with UI opacity but never too ghostly (floor ~0.45 when UI is translucent)
  const chipA = a >= 0.98 ? 1 : Math.max(0.45, Math.min(0.92, a * 0.88 + 0.12));
  const chipHoverA = a >= 0.98 ? 1 : Math.max(0.4, Math.min(0.85, chipA - 0.08));
  root.style.setProperty(
    "--chip",
    `oklch(0.26 ${chroma * 1.15} ${accentHue} / ${chipA})`,
  );
  root.style.setProperty(
    "--chip-hover",
    `oklch(0.30 ${chroma * 1.15} ${accentHue} / ${chipHoverA})`,
  );
  root.style.setProperty(
    "--tab-active",
    `oklch(0.28 ${chroma * 1.2} ${accentHue} / ${chipA})`,
  );
  // Floating menus sit ON chrome — slightly lower alpha + blur
  const popA = Math.max(0.32, Math.min(0.82, a * 0.7));
  root.style.setProperty("--popover", `oklch(0.20 ${chroma} ${accentHue} / ${popA})`);
  // Shell region paints the PRESET terminal background (translucent per UI
  // opacity) — this is what makes each theme preset's termBg actually visible.
  root.style.setProperty("--term-bg", colorWithAlpha(termBg, a));
  root.style.setProperty("--term-bg-solid", termBg);
  root.style.setProperty("--term-fg", termFg);
  root.style.setProperty("--term-bg-alpha", String(a));
  try {
    window.dispatchEvent(
      new CustomEvent("sw:ui-opacity", {
        detail: { opacity: a, termBg, termBgAlpha: "transparent" },
      }),
    );
  } catch {
    /* ignore */
  }
}
