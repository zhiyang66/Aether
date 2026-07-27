/**
 * Update check — compare current app version against a feed.
 *
 * Supported feeds:
 * 1) Custom `version.json`:
 *    { "version": "1.0.2", "notes": "...", "url": "https://..." }
 * 2) GitHub Releases API (default):
 *    https://api.github.com/repos/{owner}/{repo}/releases/latest
 *    → uses tag_name / body / html_url
 *
 * Never auto-installs; UI only prompts and can open the download page.
 */

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

/** Default feed: this project's GitHub latest release. */
export const DEFAULT_UPDATE_FEED =
  "https://api.github.com/repos/zhiyang66/Aether/releases/latest";

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

function isGitHubReleasesUrl(url: string): boolean {
  return /api\.github\.com\/repos\/[^/]+\/[^/]+\/releases(\/latest)?\/?$/i.test(
    url.replace(/\?.*$/, ""),
  );
}

/** Normalize various feed JSON shapes into RemoteVersion. */
export function parseUpdatePayload(data: unknown, feedUrl: string): RemoteVersion {
  if (!data || typeof data !== "object") {
    throw new Error("无效更新源响应");
  }
  const o = data as Record<string, unknown>;

  // GitHub Releases API (single release object)
  if (typeof o.tag_name === "string" || Array.isArray(o.assets)) {
    const tag = String(o.tag_name || o.name || "").trim();
    if (!tag) throw new Error("GitHub Release 缺少 tag_name");
    const notes = typeof o.body === "string" ? o.body : undefined;
    const htmlUrl =
      typeof o.html_url === "string"
        ? o.html_url
        : typeof o.url === "string"
          ? o.url
          : undefined;
    // Prefer browser download for setup.exe if present
    let url = htmlUrl;
    if (Array.isArray(o.assets)) {
      const assets = o.assets as Array<Record<string, unknown>>;
      const setup = assets.find((a) =>
        /\.exe$/i.test(String(a.name || "")) && /setup/i.test(String(a.name || "")),
      );
      const anyExe = assets.find((a) => /\.(exe|msi|dmg|appimage)$/i.test(String(a.name || "")));
      const pick = setup || anyExe;
      if (pick && typeof pick.browser_download_url === "string") {
        // Keep release page as primary open target; notes mention assets.
        // html_url is better UX for multi-asset releases.
        url = htmlUrl || pick.browser_download_url;
      }
    }
    return {
      version: tag.replace(/^v/i, ""),
      notes: notes?.slice(0, 2000),
      url: url || feedUrl,
    };
  }

  // Custom version.json
  const version = String(o.version || "").trim();
  if (!version) throw new Error("无效 version.json（缺少 version）");
  return {
    version: version.replace(/^v/i, ""),
    notes: o.notes != null ? String(o.notes) : undefined,
    url: o.url != null ? String(o.url) : undefined,
  };
}

/**
 * Resolve feed URL:
 * - empty / "github" / "default" → DEFAULT_UPDATE_FEED
 * - "off" / "none" / "disabled" → disabled
 * - otherwise use as-is
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

export async function checkForUpdate(opts: {
  current: string;
  feedUrl: string;
  signal?: AbortSignal;
}): Promise<UpdateCheckResult> {
  const url = resolveUpdateFeedUrl(opts.feedUrl);
  if (!url) return { status: "disabled" };
  try {
    const headers: Record<string, string> = {
      Accept: isGitHubReleasesUrl(url)
        ? "application/vnd.github+json"
        : "application/json",
    };
    if (isGitHubReleasesUrl(url)) {
      headers["X-GitHub-Api-Version"] = "2022-11-28";
    }
    const res = await fetch(url, { signal: opts.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as unknown;
    const remote = parseUpdatePayload(data, url);
    if (compareVersions(remote.version, opts.current) > 0) {
      return { status: "available", current: opts.current, remote };
    }
    return { status: "up-to-date", current: opts.current };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
