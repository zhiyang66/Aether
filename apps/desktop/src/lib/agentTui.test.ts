import { describe, expect, it } from "vitest";
import {
  agentTuiCtrlEnterSequence,
  agentTuiFromShellKey,
  detectAgentTuiFromOutput,
} from "./agentTui";

describe("agentTuiFromShellKey", () => {
  it("recognizes codex / claude profile keys", () => {
    expect(agentTuiFromShellKey("codex")).toBe("codex");
    expect(agentTuiFromShellKey("codex:default")).toBe("codex");
    expect(agentTuiFromShellKey("Claude")).toBe("claude");
    expect(agentTuiFromShellKey("claude:opus")).toBe("claude");
    expect(agentTuiFromShellKey("ps")).toBeNull();
    expect(agentTuiFromShellKey("bash")).toBeNull();
  });
});

describe("detectAgentTuiFromOutput", () => {
  it("detects Codex banners and paste attachment paths", () => {
    expect(detectAgentTuiFromOutput("OpenAI Codex v0.1")).toBe("codex");
    expect(detectAgentTuiFromOutput("Working (1.2s)")).toBe("codex");
    expect(
      detectAgentTuiFromOutput(
        "C:\\Users\\14922\\AppData\\Roaming\\com.aether.shell-workbench\\attachments\\paste-1b4c.png",
      ),
    ).toBe("codex");
  });

  it("detects Claude Code banners", () => {
    expect(detectAgentTuiFromOutput("Claude Code v2.0")).toBe("claude");
    expect(detectAgentTuiFromOutput("Anthropic Claude")).toBe("claude");
  });

  it("ignores ordinary shell output", () => {
    expect(detectAgentTuiFromOutput("PS C:\\Users\\me> ls")).toBeNull();
  });
});

describe("agentTuiCtrlEnterSequence", () => {
  const fallback = (shellKey: string) => (shellKey === "ps" ? "\x1b[13;5u" : "\x16\x0a");

  it("maps Ctrl+Enter to Alt+Enter (ESC CR) for agent TUIs", () => {
    expect(
      agentTuiCtrlEnterSequence({
        kind: "codex",
        bracketedPasteMode: true,
        shellKey: "ps",
        fallback,
      }),
    ).toBe("\x1b\r");
    expect(
      agentTuiCtrlEnterSequence({
        kind: "claude",
        bracketedPasteMode: false,
        shellKey: "bash",
        fallback,
      }),
    ).toBe("\x1b\r");
  });

  it("also uses ESC CR on the alternate screen before detection catches up", () => {
    expect(
      agentTuiCtrlEnterSequence({
        kind: null,
        alternateScreen: true,
        bracketedPasteMode: true,
        shellKey: "ps",
        fallback,
      }),
    ).toBe("\x1b\r");
  });

  it("uses shell fallback on the primary screen without an agent TUI", () => {
    expect(
      agentTuiCtrlEnterSequence({
        kind: null,
        alternateScreen: false,
        bracketedPasteMode: true,
        shellKey: "ps",
        fallback,
      }),
    ).toBe("\x1b[13;5u");
    expect(
      agentTuiCtrlEnterSequence({
        kind: null,
        alternateScreen: false,
        bracketedPasteMode: false,
        shellKey: "bash",
        fallback,
      }),
    ).toBe("\x16\x0a");
  });
});
