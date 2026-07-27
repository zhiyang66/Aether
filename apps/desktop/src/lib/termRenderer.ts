/**
 * Terminal glyph renderer preference + live status for the status bar.
 *
 * Preference (persisted): auto | webgl | canvas
 * Live status (runtime):  webgl | canvas | pending | n/a
 *
 * "auto" (default) tries WebGL first and falls back to Canvas on any failure.
 */

export type TermRendererPref = "auto" | "webgl" | "canvas";
export type TermRendererLive = "webgl" | "canvas" | "pending" | "n/a";

type Listener = (live: TermRendererLive) => void;

let live: TermRendererLive = "pending";
const listeners = new Set<Listener>();

export function getTermRendererLive(): TermRendererLive {
  return live;
}

export function setTermRendererLive(next: TermRendererLive) {
  if (live === next) return;
  live = next;
  for (const cb of listeners) {
    try {
      cb(live);
    } catch {
      /* ignore */
    }
  }
}

/** Subscribe to live renderer changes (status bar). Returns unsubscribe. */
export function onTermRendererLive(cb: Listener): () => void {
  listeners.add(cb);
  cb(live);
  return () => {
    listeners.delete(cb);
  };
}

/** Short badge for the status bar. */
export function termRendererBadge(status: TermRendererLive): {
  label: string;
  title: string;
  kind: "ok" | "warn" | "";
} {
  switch (status) {
    case "webgl":
      return {
        label: "GPU",
        title: "终端渲染：WebGL（GPU 加速）",
        kind: "ok",
      };
    case "canvas":
      return {
        label: "Canvas",
        title: "终端渲染：Canvas 2D（兼容模式 / WebGL 不可用时回退）",
        kind: "warn",
      };
    case "pending":
      return {
        label: "…",
        title: "终端渲染：初始化中",
        kind: "",
      };
    default:
      return {
        label: "—",
        title: "终端渲染：无活动会话",
        kind: "",
      };
  }
}

export function normalizeTermRendererPref(v: unknown): TermRendererPref {
  if (v === "webgl" || v === "canvas" || v === "auto") return v;
  return "auto";
}
