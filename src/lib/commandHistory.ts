export type HistoryEntry = {
  cmd: string;
  shellKey: string;
  count: number;
  lastUsedAt: string;
};

const KEY = "sw-cmd-history-v1";

/** Normalize shell key for history scope: same family shares history. */
export function historyScopeKey(shellKey: string): string {
  if (shellKey.startsWith("wsl")) return "wsl";
  if (shellKey === "ps" || shellKey.startsWith("ps")) return "ps";
  if (shellKey === "cmd") return "cmd";
  if (shellKey === "zsh") return "zsh";
  if (shellKey === "bash") return "bash";
  return shellKey || "any";
}

// Parsed-once cache: querySuggestions runs on every keystroke and recordCommand
// on every command, so avoid re-parsing the (up to thousands of entries) JSON.
let cache: HistoryEntry[] | null = null;

export function loadHistory(): HistoryEntry[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function saveHistory(entries: HistoryEntry[]) {
  cache = entries;
  localStorage.setItem(KEY, JSON.stringify(entries));
}

/** Drop terminal auto-reply debris so history never shows `[1;1R[Ipwd`. */
export function sanitizeHistoryCmd(cmd: string): string {
  let t = cmd.trim();
  if (!t) return "";
  // Strip CSI / focus / CPR prefixes glued to real commands
  t = t
    .replace(/^(?:\x1b\[[\d;?]*[A-Za-z])+/g, "")
    .replace(/^(?:\[\d{1,4};\d{1,4}R|\[\d{1,4};\d{1,4}|\[I|\[O|\d{1,4};\d{1,4}R)+/g, "")
    .trim();
  if (!t || t.length > 2000) return "";
  // Pure noise
  if (/^\[\d+;\d+R$/.test(t) || /^\[I$/.test(t) || /^\[O$/.test(t) || /^\d+;\d+R$/.test(t)) {
    return "";
  }
  return t;
}

export function recordCommand(cmd: string, shellKey: string, limit = 5000) {
  const t = sanitizeHistoryCmd(cmd);
  if (!t) return;
  // Store under normalized family key so same shell shares history
  const scope = historyScopeKey(shellKey);
  const list = loadHistory();
  const idx = list.findIndex(
    (e) => e.cmd === t && historyScopeKey(e.shellKey) === scope,
  );
  const now = new Date().toISOString();
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      shellKey: scope,
      count: list[idx].count + 1,
      lastUsedAt: now,
    };
  } else {
    list.push({ cmd: t, shellKey: scope, count: 1, lastUsedAt: now });
  }
  list.sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
  saveHistory(list.slice(0, limit));
}

export function clearHistory() {
  cache = [];
  localStorage.removeItem(KEY);
}

export function listHistoryForShell(
  shellKey: string,
  limit = 40,
): HistoryEntry[] {
  const scope = historyScopeKey(shellKey);
  return loadHistory()
    .filter(
      (e) =>
        historyScopeKey(e.shellKey) === scope || e.shellKey === "any",
    )
    .slice(0, limit);
}

export function querySuggestions(
  prefix: string,
  shellKey: string,
  opts: {
    max: number;
    useHistory: boolean;
    useFrequent: boolean;
    byShell: boolean;
    fuzzy: boolean;
  },
): { cmd: string; source: "历史" | "常用"; count: number }[] {
  if (!prefix.trim()) return [];
  let list = loadHistory();
  if (opts.byShell) {
    const scope = historyScopeKey(shellKey);
    list = list.filter(
      (e) => historyScopeKey(e.shellKey) === scope || e.shellKey === "any",
    );
  }
  const p = prefix.toLowerCase();
  const matched = list.filter((e) => {
    const c = e.cmd.toLowerCase();
    if (c.startsWith(p)) return true;
    if (opts.fuzzy && c.includes(p)) return true;
    return false;
  });

  const scored = matched.map((e) => {
    const prefixBoost = e.cmd.toLowerCase().startsWith(p) ? 1000 : 0;
    const freq = opts.useFrequent ? e.count : 0;
    const recency = new Date(e.lastUsedAt).getTime() / 1e12;
    return { e, score: prefixBoost + freq + recency };
  });
  scored.sort((a, b) => b.score - a.score);

  const out: { cmd: string; source: "历史" | "常用"; count: number }[] = [];
  for (const { e } of scored) {
    if (!opts.useHistory && e.count < 2) continue;
    if (out.length >= opts.max) break;
    out.push({
      cmd: e.cmd,
      source: e.count >= 3 ? "常用" : "历史",
      count: e.count,
    });
  }
  return out;
}
