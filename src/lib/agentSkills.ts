/**
 * Agent skills — capability briefs injected into the system prompt.
 *
 * Skills live as standard files on disk: `~/.aether/skills/<id>/SKILL.md`
 * (YAML frontmatter + markdown body), the same shape Codex/Claude use. The repo
 * `skills/<id>/SKILL.md` files are the built-in source of truth; the Rust
 * backend seeds them into `~/.aether/skills/` on first run, and users may edit
 * or add their own. This module loads them (from disk in the desktop app, from
 * the bundled copies in a browser) and caches them so `formatAgentSkillsPrompt`
 * can stay synchronous.
 *
 * Prefer teaching the model *when/how* to use tools & actions over client-side
 * hardcoding.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./window";

export type AgentSkill = {
  id: string;
  title: string;
  body: string;
  /** One-line summary for the Settings → Skills list (display only). */
  summary?: string;
  /** Grouping label for the Settings list (display only). */
  category?: string;
  /** True for skills shipped with Aether; false for user-authored files. */
  builtin?: boolean;
};

/** Stable display / injection order for the built-in skills. */
const BUILTIN_ORDER = [
  "tools",
  "workbench",
  "app-control",
  "mcp-setup",
  "ssh-hosts",
  "utilities",
  "actions",
  "interactive-cli",
  "skill-creator",
];

/**
 * Parse a `SKILL.md` text into an AgentSkill. Frontmatter is the block between
 * the first two `---` fences; the rest is the markdown body. CRLF and a leading
 * BOM are tolerated. Mirrors the Rust `parse_frontmatter`.
 */
export function parseSkillFile(text: string, fallbackId = ""): AgentSkill {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const fm: Record<string, string> = {};
  let body = normalized.trim();
  const m = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    for (const line of m[1].split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf(":");
      if (idx === -1) continue;
      const key = t.slice(0, idx).trim();
      const val = t.slice(idx + 1).trim();
      if (key) fm[key] = val;
    }
    body = normalized.slice(m[0].length).trim();
  }
  const id = fm.name || fallbackId;
  return {
    id,
    title: fm.title || id,
    summary: fm.description || undefined,
    category: fm.category || undefined,
    body,
    builtin: true,
  };
}

/** Folder name from a glob key like `/skills/tools/SKILL.md` → `tools`. */
function idFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : path;
}

function orderBuiltins(skills: AgentSkill[]): AgentSkill[] {
  const rank = (id: string) => {
    const i = BUILTIN_ORDER.indexOf(id);
    return i === -1 ? BUILTIN_ORDER.length : i;
  };
  return [...skills].sort((a, b) => {
    const ra = rank(a.id);
    const rb = rank(b.id);
    return ra !== rb ? ra - rb : a.id.localeCompare(b.id);
  });
}

/**
 * Built-in skills parsed from the bundled repo `skills/**​/SKILL.md` files.
 * Available synchronously everywhere (browser included) via Vite's glob import;
 * used as the cache's initial value and the non-desktop fallback.
 */
const BUILTIN_RAW = import.meta.glob("/skills/*/SKILL.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const BUILTIN_SKILLS: AgentSkill[] = orderBuiltins(
  Object.entries(BUILTIN_RAW).map(([path, text]) =>
    parseSkillFile(text, idFromPath(path)),
  ),
);

/** Module cache — starts as built-ins, refreshed from disk in the desktop app. */
let cache: AgentSkill[] = BUILTIN_SKILLS;

/** Current skills (cached). */
export function getSkills(): AgentSkill[] {
  return cache;
}

/**
 * Load skills: from `~/.aether/skills/` in the desktop app (so user edits and
 * additions take effect), or the bundled built-ins in a browser / on failure.
 */
export async function loadSkills(): Promise<AgentSkill[]> {
  if (!isTauri()) return BUILTIN_SKILLS;
  try {
    const files = await invoke<
      Array<{
        id: string;
        title: string;
        category: string;
        summary: string;
        body: string;
        builtin: boolean;
      }>
    >("skills_list");
    if (!Array.isArray(files) || files.length === 0) return BUILTIN_SKILLS;
    return files.map((f) => ({
      id: f.id,
      title: f.title || f.id,
      summary: f.summary || undefined,
      category: f.category || undefined,
      body: f.body,
      builtin: f.builtin,
    }));
  } catch {
    return BUILTIN_SKILLS;
  }
}

/** Refresh the cache from disk. Call at startup and when the Skills UI opens. */
export async function refreshSkills(): Promise<AgentSkill[]> {
  cache = await loadSkills();
  return cache;
}

/** Compose a SKILL.md file (frontmatter + body) from skill fields. */
export function composeSkillFile(s: {
  id: string;
  title?: string;
  category?: string;
  summary?: string;
  body: string;
}): string {
  const lines = ["---", `name: ${s.id}`];
  if (s.title) lines.push(`title: ${s.title}`);
  if (s.category) lines.push(`category: ${s.category}`);
  if (s.summary) lines.push(`description: ${s.summary}`);
  lines.push("---", "", s.body.trim(), "");
  return lines.join("\n");
}

/**
 * Write (create/overwrite) a skill to `~/.aether/skills/<id>/SKILL.md`, then
 * refresh the cache so it takes effect on the next turn. Desktop only.
 */
export async function writeSkill(s: {
  id: string;
  title?: string;
  category?: string;
  summary?: string;
  body: string;
}): Promise<string> {
  if (!isTauri()) throw new Error("写入 Skill 需要桌面环境");
  const path = await invoke<string>("skill_write", {
    id: s.id,
    contents: composeSkillFile(s),
  });
  await refreshSkills();
  return path;
}

/** Delete a skill directory, then refresh the cache. Desktop only. */
export async function deleteSkill(id: string): Promise<void> {
  if (!isTauri()) throw new Error("删除 Skill 需要桌面环境");
  await invoke("skill_delete", { id });
  await refreshSkills();
}

/** Flatten skills into system prompt section. Reads the cache by default. */
export function formatAgentSkillsPrompt(skills: AgentSkill[] = getSkills()): string {
  const parts = skills.map((s) => `### Skill: ${s.title}\n${s.body}`);
  return `## Skills（请按需运用，勿机械套模板）\n\n${parts.join("\n\n")}`;
}
