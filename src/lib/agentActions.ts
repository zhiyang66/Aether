/**
 * Structured actions from Agent replies.
 * Buttons are **only** from model-emitted JSON (or explicit typed markdown).
 * Do not invent chips client-side — teach the model via agentSkills.
 */

export type AgentAction = {
  type: "insert" | "run" | "insert_and_run" | "focus" | "reply";
  targetSerial?: number;
  command?: string;
  /** type=reply: follow-up user message text */
  text?: string;
  label?: string;
  note?: string;
};

/** Greedy-enough fence: allow trailing prose after the JSON object/array. */
const JSON_FENCE_GLOBAL =
  /```(?:json)?\s*\r?\n?([\s\S]*?)```/gi;

function tryParseActionsPayload(src: string): AgentAction[] {
  const t = src.trim();
  if (!t) return [];
  // Direct JSON
  try {
    const raw = JSON.parse(t) as { actions?: unknown[] } | unknown[];
    const list = Array.isArray(raw) ? raw : raw.actions;
    if (Array.isArray(list)) {
      const parsed = list.map(normalizeAction).filter((a): a is AgentAction => !!a);
      if (parsed.length) return dedupeActions(parsed);
    }
  } catch {
    /* try extract embedded object */
  }
  // Embedded {"actions":[...]} possibly with trailing commas / noise
  const bare = t.match(/\{\s*"actions"\s*:\s*\[[\s\S]*\]\s*\}/);
  if (bare) {
    try {
      const raw = JSON.parse(bare[0]) as { actions?: unknown[] };
      if (Array.isArray(raw.actions)) {
        const parsed = raw.actions
          .map(normalizeAction)
          .filter((a): a is AgentAction => !!a);
        if (parsed.length) return dedupeActions(parsed);
      }
    } catch {
      /* ignore */
    }
  }
  // Bare array of action objects
  const arr = t.match(/\[\s*\{\s*"type"[\s\S]*\}\s*\]/);
  if (arr) {
    try {
      const list = JSON.parse(arr[0]) as unknown[];
      if (Array.isArray(list)) {
        const parsed = list.map(normalizeAction).filter((a): a is AgentAction => !!a);
        if (parsed.length) return dedupeActions(parsed);
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

export function parseAgentActions(text: string): AgentAction[] {
  if (!text?.trim()) return [];

  // 1) All fenced blocks (model sometimes puts actions in the last of several)
  const fences = [...text.matchAll(JSON_FENCE_GLOBAL)];
  for (let i = fences.length - 1; i >= 0; i--) {
    const parsed = tryParseActionsPayload(fences[i][1] || "");
    if (parsed.length) return parsed;
  }

  // 2) Unfenced {"actions":[...]} anywhere
  const embedded = tryParseActionsPayload(text);
  if (embedded.length) return embedded;

  // 2) Explicit markdown only: "- run #2: cmd" (not bare "1. Yes")
  const out: AgentAction[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(
      /^\s*(?:[-*+]|\d+\.)\s*(?:(run|insert|insert_and_run|focus|reply)\s+)#?(\d+)?\s*[:：]?\s*(.*)$/i,
    );
    if (!m) continue;
    const kind = m[1].toLowerCase();
    const serial = m[2] ? Number(m[2]) : undefined;
    const rest = (m[3] || "").trim().replace(/^`|`$/g, "");
    if (kind === "focus") {
      if (serial == null) continue;
      out.push({ type: "focus", targetSerial: serial, label: `聚焦 #${serial}` });
    } else if (kind === "reply" && rest) {
      out.push({ type: "reply", text: rest, label: rest.slice(0, 16) });
    } else if (rest) {
      out.push({
        type:
          kind === "insert"
            ? "insert"
            : kind === "insert_and_run"
              ? "insert_and_run"
              : "run",
        targetSerial: serial,
        command: rest,
      });
    }
  }

  return dedupeActions(out);
}

function normalizeAction(x: unknown): AgentAction | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const t = String(o.type ?? o.action ?? "run").toLowerCase();
  const serialRaw = o.targetSerial ?? o.target_serial ?? o.serial ?? o.pane;
  const targetSerial =
    serialRaw == null || serialRaw === ""
      ? undefined
      : Number(serialRaw);
  const serialOk =
    targetSerial != null && Number.isFinite(targetSerial)
      ? targetSerial
      : undefined;
  const label =
    o.label != null
      ? String(o.label)
      : o.note != null
        ? String(o.note)
        : undefined;
  const command = String(o.command ?? o.cmd ?? "").trim();
  const text = String(o.text ?? o.prompt ?? o.message ?? "").trim();

  if (t === "focus" || t === "focus_pane") {
    if (serialOk == null) return null;
    return {
      type: "focus",
      targetSerial: serialOk,
      label: label || `聚焦 #${serialOk}`,
      note: o.note != null ? String(o.note) : undefined,
    };
  }

  if (t === "reply" || t === "follow_up" || t === "ask") {
    if (!text && !command) return null;
    const body = text || command;
    return {
      type: "reply",
      text: body,
      label: label || body.slice(0, 16),
      note: o.note != null ? String(o.note) : undefined,
    };
  }

  if (!command) return null;

  const type: AgentAction["type"] =
    t === "insert" || t === "insert_only" || t === "insert_in_pane"
      ? "insert"
      : t === "insert_and_run" || t === "insert-run" || t === "run_and_insert"
        ? "insert_and_run"
        : "run";

  return {
    type,
    command,
    targetSerial: serialOk,
    label: label || defaultLabel(type, serialOk, command),
    note: o.note != null ? String(o.note) : undefined,
  };
}

function defaultLabel(
  type: AgentAction["type"],
  serial: number | undefined,
  command: string,
): string {
  const short =
    command.length > 28 ? command.slice(0, 26).trimEnd() + "…" : command;
  const where = serial != null ? ` · #${serial}` : "";
  if (type === "insert") return `插入${where}: ${short}`;
  if (type === "insert_and_run") return `插入并运行${where}`;
  if (type === "focus") return `聚焦 #${serial ?? "?"}`;
  if (type === "reply") return "继续";
  return `运行${where}`;
}

function dedupeActions(list: AgentAction[]): AgentAction[] {
  const seen = new Set<string>();
  const out: AgentAction[] = [];
  for (const a of list) {
    const key = `${a.type}|${a.targetSerial ?? ""}|${a.command ?? ""}|${a.text ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out.slice(0, 8);
}

export function actionChipLabel(a: AgentAction): string {
  if (a.label?.trim()) return a.label.trim();
  if (a.type === "focus") return `聚焦 #${a.targetSerial ?? "?"}`;
  if (a.type === "insert") return "仅插入";
  if (a.type === "insert_and_run") return "插入并运行";
  if (a.type === "reply") return "继续对话";
  return "运行";
}
