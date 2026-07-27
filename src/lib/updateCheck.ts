/**
 * Update check — compare current app version against a feed.
 *
 * Default feed avoids api.github.com (anonymous rate limit / 403):
 *   https://github.com/{owner}/{repo}/releases/latest
 *   with Accept: application/json → { tag_name, html_url, ... }
 *
 * Fallback:
 *   raw.githubusercontent.com/.../public/version.json
 *
 * Custom version.json still supported:
 *   { "version": "1.0.3", "notes": "...", "url": "https://..." }
 *
 * Fetch goes through Rust `update_feed_fetch` in Tauri (CSP + proper UA).
 * Never auto-installs.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./window";

export type RemoteVersion = {
  version: string;
  notes?: string;
  url?: string;
};

export type UpdateCheckResult =
  | { status: "disabled" }
  | { status: "up-to-date"; current: string }
  | { status: "available"; current: string; remote: RemoteVersion }
  | { status: "error"; message: string };

/** Prefer github.com (not api.github.com) to avoid anonymous API rate limits. */
export const DEFAULT_UPDATE_FEED =
  "https://github.com/zhiyang66/Aether/releases/latest";

/** Static fallback if the releases page is unreachable. */
export const FALLBACK_VERSION_JSON =
  "https://raw.githubusercontent.com/zhiyang66/Aether/master/public/version.json";

/** Semver-ish compare: 1 if a>b, -1 if a<b, 0 equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/i, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

/** Normalize various feed JSON shapes into RemoteVersion. */
export function parseUpdatePayload(data: unknown, feedUrl: string): RemoteVersion {
  if (!data || typeof data !== "object") {
    throw new Error("无效更新源响应");
  }
  const o = data as Record<string, unknown>;

  // GitHub Releases — API or github.com/releases/latest?Accept=application/json
  if (
    typeof o.tag_name === "string" ||
    typeof o.tag_name === "number" ||
    Array.isArray(o.assets)
  ) {
    const tag = String(o.tag_name || o.name || "").trim();
    if (!tag) throw new Error("GitHub Release 缺少 tag_name");
    const notes = typeof o.body === "string" ? o.body : undefined;
    const ver = tag.replace(/^v/i, "");
    const tagPath = tag.startsWith("v") ? tag : `v${tag}`;
    // github.com/releases/latest?Accept=json sometimes omits html_url
    const htmlUrl =
      (typeof o.html_url === "string" && o.html_url) ||
      (typeof o.url === "string" && String(o.url).includes("/releases/")
        ? String(o.url)
        : "") ||
      `https://github.com/zhiyang66/Aether/releases/tag/${tagPath}`;
    return {
      version: ver,
      notes: notes?.slice(0, 2000),
      url: htmlUrl,
    };
  }

  // Custom version.json
  const version = String(o.version || "").trim();
  if (!version) throw new Error("无效 version.json（缺少 version）");
  return {
    version: version.replace(/^v/i, ""),
    notes: o.notes != null ? String(o.notes) : undefined,
    url:
      o.url != null
        ? String(o.url)
        : "https://github.com/zhiyang66/Aether/releases/latest",
  };
}

/**
 * Resolve feed URL. Empty / github / default → GitHub releases/latest page.
 * Custom URL still accepted for tests; UI no longer exposes the field.
 */
export function resolveUpdateFeedUrl(configured: string | undefined | null): string | null {
  const raw = (configured ?? "").trim();
  if (!raw || raw.toLowerCase() === "github" || raw.toLowerCase() === "default") {
    return DEFAULT_UPDATE_FEED;
  }
  if (["off", "none", "disabled", "false", "0"].includes(raw.toLowerCase())) {
    return null;
  }
  return raw;
}

async function fetchFeedText(url: string, signal?: AbortSignal): Promise<string> {
  if (isTauri()) {
    return invoke<string>("update_feed_fetch", { url });
  }
  // Browser dev: github.com/releases/latest needs Accept: application/json
  const headers: Record<string, string> = {
    Accept: url.includes("github.com/") && url.includes("/releases/")
      ? "application/json"
      : "application/json",
  };
  const res = await fetch(url, { signal, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  return res.text();
}

function friendlyFetchError(message: string): string {
  if (/403|rate limit/i.test(message)) {
    return "GitHub 请求受限，请稍后再试（已避免 api.github.com 限流；若仍失败请检查网络）";
  }
  return message;
}

async function loadRemote(url: string, signal?: AbortSignal): Promise<RemoteVersion> {
  const text = await fetchFeedText(url, signal);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("更新源返回的不是 JSON");
  }
  return parseUpdatePayload(data, url);
}

export async function checkForUpdate(opts: {
  current: string;
  feedUrl: string;
  signal?: AbortSignal;
}): Promise<UpdateCheckResult> {
  const url = resolveUpdateFeedUrl(opts.feedUrl);
  if (!url) return { status: "disabled" };
  try {
    let remote: RemoteVersion;
    try {
      remote = await loadRemote(url, opts.signal);
    } catch (primaryErr) {
      // If default GitHub path fails, try static version.json on the repo
      const primaryMsg =
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      if (url === DEFAULT_UPDATE_FEED) {
        try {
          remote = await loadRemote(FALLBACK_VERSION_JSON, opts.signal);
        } catch (fallbackErr) {
          const fb =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          throw new Error(friendlyFetchError(`${primaryMsg}；备用源: ${fb}`));
        }
      } else {
        throw new Error(friendlyFetchError(primaryMsg));
      }
    }
    if (compareVersions(remote.version, opts.current) > 0) {
      return { status: "available", current: opts.current, remote };
    }
    return { status: "up-to-date", current: opts.current };
  } catch (e) {
    return {
      status: "error",
      message: friendlyFetchError(e instanceof Error ? e.message : String(e)),
    };
  }
}
