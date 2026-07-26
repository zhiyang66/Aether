/**
 * 1.0 分级审批体系 — the single gate for every Agent-initiated capability:
 * built-in workbench tools, run_command, and MCP tool calls.
 *
 * Model: ordered rules (first match wins) on top of a preset default.
 * Dangerous commands (danger.ts) escalate allow → ask unless an explicit
 * rule allows them. "总是允许" writes a rule, visible & revocable in settings.
 */

import { isDangerousCommand } from "./danger";

export type ApprovalScope = "tool" | "command-pattern" | "mcp-server";
export type ApprovalDecision = "allow" | "deny" | "ask";

export type ApprovalRule = {
  scope: ApprovalScope;
  /** tool name / command glob / mcp server name */
  key: string;
  decision: ApprovalDecision;
};

export type ApprovalPreset = "conservative" | "balanced" | "free";

export type ApprovalStore = {
  version: 1;
  preset: ApprovalPreset;
  rules: ApprovalRule[];
};

export const APPROVAL_KEY = "sw-approval-v1";

export const PRESET_LABELS: Record<ApprovalPreset, string> = {
  conservative: "保守 · 全部询问",
  balanced: "平衡 · 只读放行，写操作询问",
  free: "放手 · 默认放行，危险命令仍询问",
};

/** Tools that only read state — safe to auto-allow in balanced preset. */
export const READ_ONLY_TOOLS = new Set([
  "list_panes",
  "read_pane",
  "task_read",
]);

/**
 * Workbench-local operations (layout, tabs, task bookkeeping, app settings):
 * they never touch the system shell, so balanced auto-allows them too.
 * run_command and MCP calls are NOT here — those ask.
 */
export const LOW_RISK_TOOLS = new Set([
  "split_pane",
  "new_tab",
  "close_pane",
  "focus_pane",
  "clear_pane",
  "apply_layout_template",
  "workspace",
  "app_settings",
  "task_create",
  "task_update_step",
  "task_add_steps",
]);

const listeners = new Set<() => void>();

export function onApprovalChanged(l: () => void): () => void {
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

export function loadApproval(): ApprovalStore {
  try {
    const raw = localStorage.getItem(APPROVAL_KEY);
    if (!raw) return { version: 1, preset: "balanced", rules: [] };
    const data = JSON.parse(raw) as Partial<ApprovalStore>;
    return {
      version: 1,
      preset:
        data.preset === "conservative" || data.preset === "free"
          ? data.preset
          : "balanced",
      rules: Array.isArray(data.rules)
        ? data.rules.filter(
            (r) =>
              r &&
              ["tool", "command-pattern", "mcp-server"].includes(r.scope) &&
              typeof r.key === "string" &&
              ["allow", "deny", "ask"].includes(r.decision),
          )
        : [],
    };
  } catch {
    return { version: 1, preset: "balanced", rules: [] };
  }
}

export function saveApproval(store: ApprovalStore) {
  localStorage.setItem(
    APPROVAL_KEY,
    JSON.stringify({ ...store, rules: store.rules.slice(0, 200) }),
  );
  emit();
}

export function setPreset(preset: ApprovalPreset) {
  const s = loadApproval();
  s.preset = preset;
  saveApproval(s);
}

export function addRule(rule: ApprovalRule) {
  const s = loadApproval();
  // Replace an existing rule for the same scope+key (newest wins, stays at top)
  s.rules = [rule, ...s.rules.filter((r) => !(r.scope === rule.scope && r.key === rule.key))];
  saveApproval(s);
}

export function removeRule(scope: ApprovalScope, key: string) {
  const s = loadApproval();
  s.rules = s.rules.filter((r) => !(r.scope === scope && r.key === key));
  saveApproval(s);
}

/** Glob → RegExp: `*` any run, `?` one char; everything else literal. */
export function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
}

export type ApprovalRequest = {
  /** built-in tool name, or mcp tool full name */
  tool: string;
  /** shell command when the tool is run_command */
  command?: string;
  /** mcp server name when the tool is an MCP call */
  mcpServer?: string;
};

export type ApprovalVerdict = {
  decision: ApprovalDecision;
  /** why: rule hit / preset default / danger escalation */
  reason: string;
  dangerous: boolean;
};

/**
 * Resolve a request against rules → preset → danger escalation.
 * Rules are evaluated in order; first match wins.
 */
export function resolveApproval(
  req: ApprovalRequest,
  store: ApprovalStore = loadApproval(),
): ApprovalVerdict {
  const dangerous = !!req.command && isDangerousCommand(req.command);

  for (const r of store.rules) {
    if (r.scope === "tool" && r.key === req.tool) {
      return { decision: r.decision, reason: `规则: 工具 ${r.key}`, dangerous };
    }
    if (r.scope === "mcp-server" && req.mcpServer && r.key === req.mcpServer) {
      return { decision: r.decision, reason: `规则: MCP ${r.key}`, dangerous };
    }
    if (r.scope === "command-pattern" && req.command) {
      try {
        if (globToRegex(r.key).test(req.command.trim())) {
          return { decision: r.decision, reason: `规则: 命令 ${r.key}`, dangerous };
        }
      } catch {
        /* bad glob → skip */
      }
    }
  }

  // Preset defaults
  let decision: ApprovalDecision;
  let reason: string;
  if (store.preset === "conservative") {
    decision = "ask";
    reason = "预设: 保守（全部询问）";
  } else if (store.preset === "balanced") {
    if (READ_ONLY_TOOLS.has(req.tool) || LOW_RISK_TOOLS.has(req.tool)) {
      decision = "allow";
      reason = "预设: 平衡（工作台内操作放行）";
    } else {
      decision = "ask";
      reason = "预设: 平衡（系统级操作询问）";
    }
  } else {
    decision = "allow";
    reason = "预设: 放手";
  }

  // Danger escalation: an implicit allow never covers a dangerous command
  if (dangerous && decision === "allow") {
    decision = "ask";
    reason = "危险命令升级为询问";
  }
  return { decision, reason, dangerous };
}
