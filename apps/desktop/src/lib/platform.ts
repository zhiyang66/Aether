/** Lightweight platform detection for UI chrome (titlebar controls). */

export type HostPlatform = "macos" | "windows" | "linux" | "unknown";

export function hostPlatform(): HostPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  const plat = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  const p = `${plat || ""} ${navigator.platform || ""} ${ua}`.toLowerCase();
  if (p.includes("mac")) return "macos";
  if (p.includes("win")) return "windows";
  if (p.includes("linux") || p.includes("x11")) return "linux";
  return "unknown";
}

export function isMacOS(): boolean {
  return hostPlatform() === "macos";
}

export function isWindows(): boolean {
  return hostPlatform() === "windows";
}

/** Window control side preference (persisted). */
export type WindowControlsSidePref = "auto" | "left" | "right";

/** Resolved side used for layout/chrome. */
export type WindowControlsSide = "left" | "right";

/**
 * Resolve caption-button side:
 * - auto → macOS left (traffic lights), others right (Windows chrome)
 * - left / right → force that side (and matching button style)
 */
export function resolveWindowControlsSide(
  pref: WindowControlsSidePref | undefined | null,
): WindowControlsSide {
  if (pref === "left" || pref === "right") return pref;
  return isMacOS() ? "left" : "right";
}
