import { beforeEach, describe, expect, it } from "vitest";
import {
  addRule,
  APPROVAL_KEY,
  globToRegex,
  loadApproval,
  removeRule,
  resolveApproval,
  setPreset,
  type ApprovalStore,
} from "./approval";

beforeEach(() => localStorage.removeItem(APPROVAL_KEY));

const store = (over: Partial<ApprovalStore>): ApprovalStore => ({
  version: 1,
  preset: "balanced",
  rules: [],
  ...over,
});

describe("preset defaults", () => {
  it("conservative asks for everything", () => {
    const s = store({ preset: "conservative" });
    expect(resolveApproval({ tool: "list_panes" }, s).decision).toBe("ask");
    expect(resolveApproval({ tool: "run_command", command: "ls" }, s).decision).toBe("ask");
  });

  it("balanced allows read-only and workbench-local, asks for run_command", () => {
    const s = store({ preset: "balanced" });
    expect(resolveApproval({ tool: "read_pane" }, s).decision).toBe("allow");
    expect(resolveApproval({ tool: "split_pane" }, s).decision).toBe("allow");
    expect(resolveApproval({ tool: "task_update_step" }, s).decision).toBe("allow");
    expect(resolveApproval({ tool: "run_command", command: "ls" }, s).decision).toBe("ask");
    expect(
      resolveApproval({ tool: "mcp__fs__read", mcpServer: "fs" }, s).decision,
    ).toBe("ask");
  });

  it("free allows everything except dangerous commands (escalate to ask)", () => {
    const s = store({ preset: "free" });
    expect(resolveApproval({ tool: "run_command", command: "ls" }, s).decision).toBe("allow");
    const v = resolveApproval({ tool: "run_command", command: "rm -rf /" }, s);
    expect(v.decision).toBe("ask");
    expect(v.dangerous).toBe(true);
  });
});

describe("rules (first match wins, beat preset)", () => {
  it("tool rule beats preset", () => {
    const s = store({
      preset: "conservative",
      rules: [{ scope: "tool", key: "read_pane", decision: "allow" }],
    });
    expect(resolveApproval({ tool: "read_pane" }, s).decision).toBe("allow");
  });

  it("command glob matches and can deny", () => {
    const s = store({
      preset: "free",
      rules: [{ scope: "command-pattern", key: "git push*", decision: "deny" }],
    });
    expect(
      resolveApproval({ tool: "run_command", command: "git push origin main" }, s).decision,
    ).toBe("deny");
    expect(
      resolveApproval({ tool: "run_command", command: "git status" }, s).decision,
    ).toBe("allow");
  });

  it("explicit allow rule overrides danger escalation", () => {
    const s = store({
      preset: "balanced",
      rules: [
        { scope: "command-pattern", key: "rm -rf ./build", decision: "allow" },
      ],
    });
    expect(
      resolveApproval({ tool: "run_command", command: "rm -rf ./build" }, s).decision,
    ).toBe("allow");
  });

  it("mcp-server rule matches by server name", () => {
    const s = store({
      preset: "conservative",
      rules: [{ scope: "mcp-server", key: "fs", decision: "allow" }],
    });
    expect(
      resolveApproval({ tool: "mcp__fs__read_file", mcpServer: "fs" }, s).decision,
    ).toBe("allow");
    expect(
      resolveApproval({ tool: "mcp__web__fetch", mcpServer: "web" }, s).decision,
    ).toBe("ask");
  });

  it("first matching rule wins over later ones", () => {
    const s = store({
      rules: [
        { scope: "command-pattern", key: "npm run deploy", decision: "deny" },
        { scope: "command-pattern", key: "npm *", decision: "allow" },
      ],
    });
    expect(
      resolveApproval({ tool: "run_command", command: "npm run deploy" }, s).decision,
    ).toBe("deny");
    expect(
      resolveApproval({ tool: "run_command", command: "npm test" }, s).decision,
    ).toBe("allow");
  });
});

describe("persistence helpers", () => {
  it("addRule dedupes by scope+key with newest first", () => {
    addRule({ scope: "tool", key: "run_command", decision: "ask" });
    addRule({ scope: "tool", key: "run_command", decision: "allow" });
    const s = loadApproval();
    expect(s.rules).toHaveLength(1);
    expect(s.rules[0].decision).toBe("allow");
    removeRule("tool", "run_command");
    expect(loadApproval().rules).toHaveLength(0);
  });

  it("setPreset persists", () => {
    setPreset("free");
    expect(loadApproval().preset).toBe("free");
  });
});

describe("globToRegex", () => {
  it("* spans, ? single, literals escaped", () => {
    expect(globToRegex("npm *").test("npm install")).toBe(true);
    expect(globToRegex("npm *").test("pnpm install")).toBe(false);
    expect(globToRegex("a?c").test("abc")).toBe(true);
    expect(globToRegex("1+1").test("1+1")).toBe(true);
    expect(globToRegex("1+1").test("111")).toBe(false);
  });
});
