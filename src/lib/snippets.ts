/**
 * Snippets library (0.9 效率层): reusable command templates with {param}
 * placeholders. Stored in localStorage; consumed by command palette and
 * pane insertion. Import/export as JSON via settings.
 */

export type SnippetParam = { name: string; default?: string };

export type Snippet = {
  id: string;
  name: string;
  /** Command template, placeholders as {param} */
  template: string;
  params: SnippetParam[];
  /** Restrict to shells (catalog keys); empty/undefined = all */
  shellKeys?: string[];
  tags?: string[];
};

export const SNIPPETS_KEY = "sw-snippets-v1";

const listeners = new Set<() => void>();

export function onSnippetsChanged(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(SNIPPETS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isValidSnippet) : [];
  } catch {
    return [];
  }
}

export function saveSnippets(list: Snippet[]) {
  localStorage.setItem(SNIPPETS_KEY, JSON.stringify(list.slice(0, 200)));
  emit();
}

export function isValidSnippet(s: unknown): s is Snippet {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    !!o.name.trim() &&
    typeof o.template === "string" &&
    !!o.template.trim() &&
    Array.isArray(o.params) &&
    o.params.every(
      (p) =>
        p &&
        typeof p === "object" &&
        typeof (p as SnippetParam).name === "string",
    )
  );
}

export function upsertSnippet(snippet: Snippet) {
  const list = loadSnippets();
  const idx = list.findIndex((s) => s.id === snippet.id);
  if (idx >= 0) list[idx] = snippet;
  else list.unshift(snippet);
  saveSnippets(list);
}

export function deleteSnippet(id: string) {
  saveSnippets(loadSnippets().filter((s) => s.id !== id));
}

/** Extract unique placeholder names from a template, in order. */
export function extractParams(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{([a-zA-Z_][\w-]*)\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Render a template with values. Missing values fall back to the param
 * default, then to keeping the placeholder literal (visible to the user).
 */
export function renderSnippet(
  snippet: Pick<Snippet, "template" | "params">,
  values: Record<string, string> = {},
): string {
  return snippet.template.replace(/\{([a-zA-Z_][\w-]*)\}/g, (whole, name: string) => {
    if (values[name] != null && values[name] !== "") return values[name];
    const def = snippet.params.find((p) => p.name === name)?.default;
    if (def != null && def !== "") return def;
    return whole;
  });
}

/** Snippets available for a shell (undefined/empty shellKeys = universal). */
export function snippetsForShell(shellKey: string): Snippet[] {
  return loadSnippets().filter(
    (s) =>
      !s.shellKeys?.length ||
      s.shellKeys.some((k) => shellKey === k || shellKey.startsWith(`${k}:`)),
  );
}

export function exportSnippetsJson(): string {
  return JSON.stringify(loadSnippets(), null, 2);
}

/** Merge-import; returns number imported. Throws on invalid JSON. */
export function importSnippetsJson(json: string): number {
  const data = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error("JSON 顶层必须是数组");
  const valid = data.filter(isValidSnippet);
  const list = loadSnippets();
  let n = 0;
  for (const s of valid) {
    const idx = list.findIndex((x) => x.id === s.id);
    if (idx >= 0) list[idx] = s;
    else list.push(s);
    n++;
  }
  saveSnippets(list);
  return n;
}

export function newSnippetId(): string {
  return `snip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
