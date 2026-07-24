/**
 * Optional update check (2.x) — compare remote version.json, prompt only.
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

export async function checkForUpdate(opts: {
  current: string;
  feedUrl: string;
  signal?: AbortSignal;
}): Promise<UpdateCheckResult> {
  const url = opts.feedUrl.trim();
  if (!url) return { status: "disabled" };
  try {
    const res = await fetch(url, {
      signal: opts.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RemoteVersion;
    if (!data?.version) throw new Error("无效 version.json");
    if (compareVersions(data.version, opts.current) > 0) {
      return { status: "available", current: opts.current, remote: data };
    }
    return { status: "up-to-date", current: opts.current };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
