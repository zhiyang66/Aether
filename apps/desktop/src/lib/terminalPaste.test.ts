import { describe, expect, it } from "vitest";
import {
  prepareTerminalPaste,
  supportsBracketedPaste,
  validateAgentShellCommand,
} from "./terminalPaste";

describe("prepareTerminalPaste", () => {
  it("normalizes line endings and wraps multiline shell paste", () => {
    expect(prepareTerminalPaste("one\r\ntwo\rthree", "bash")).toEqual({
      ok: true,
      payload: "\x1b[200~one\ntwo\nthree\x1b[201~",
    });
  });

  it("supports SSH and rejects multiline cmd paste", () => {
    expect(supportsBracketedPaste("ssh:server")).toBe(true);
    expect(prepareTerminalPaste("one\ntwo", "cmd")).toEqual({
      ok: false,
      reason: "cmd 不支持安全的多行粘贴，请拆成单行后再执行",
    });
  });
});

describe("validateAgentShellCommand", () => {
  it("accepts a normal single-line command", () => {
    expect(validateAgentShellCommand("whoami")).toEqual({
      ok: true,
      payload: "whoami",
    });
  });

  it("rejects multiline commands, heredocs, and compound shell syntax", () => {
    expect(validateAgentShellCommand("whoami\nhostname").ok).toBe(false);
    expect(validateAgentShellCommand("cat <<'EOF'").ok).toBe(false);
    expect(validateAgentShellCommand("whoami; hostname").ok).toBe(false);
    expect(validateAgentShellCommand("ps aux | grep ssh").ok).toBe(false);
    expect(validateAgentShellCommand("curl https://host/?key=value").ok).toBe(false);
  });

  it("rejects overly long automatic commands", () => {
    expect(validateAgentShellCommand("a".repeat(241)).ok).toBe(false);
  });
});
