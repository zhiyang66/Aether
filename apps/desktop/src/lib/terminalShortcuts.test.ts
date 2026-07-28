import { describe, expect, it } from "vitest";
import { ctrlEnterSequenceForShell, resolveTerminalShortcut } from "./terminalShortcuts";

const base = {
  type: "keydown",
  key: "c",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};

describe("resolveTerminalShortcut", () => {
  it("Ctrl+C without selection → sigint", () => {
    expect(resolveTerminalShortcut(base, { hasSelection: false, selection: "" })).toEqual({
      action: "sigint",
    });
  });

  it("Ctrl+C with selection → copy", () => {
    expect(
      resolveTerminalShortcut(base, { hasSelection: true, selection: "hello" }),
    ).toEqual({ action: "copy", text: "hello" });
  });

  it("Ctrl+Shift+C → copy even without selection", () => {
    expect(
      resolveTerminalShortcut(
        { ...base, shiftKey: true },
        { hasSelection: false, selection: "" },
      ),
    ).toEqual({ action: "copy", text: "" });
  });

  it("Ctrl+V → paste", () => {
    expect(
      resolveTerminalShortcut({ ...base, key: "v" }, { hasSelection: false, selection: "" }),
    ).toEqual({ action: "paste" });
  });

  it("Ctrl+L → clear", () => {
    expect(
      resolveTerminalShortcut({ ...base, key: "l" }, { hasSelection: false, selection: "" }),
    ).toEqual({ action: "clear" });
  });

  it("Shift+Insert → paste", () => {
    expect(
      resolveTerminalShortcut(
        {
          type: "keydown",
          key: "Insert",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: true,
        },
        { hasSelection: false, selection: "" },
      ),
    ).toEqual({ action: "paste" });
  });

  it("plain keys pass through", () => {
    expect(
      resolveTerminalShortcut(
        { ...base, ctrlKey: false, key: "a" },
        { hasSelection: false, selection: "" },
      ),
    ).toEqual({ action: "pass" });
  });

  it("plain Home and End remain terminal keys", () => {
    for (const key of ["Home", "End"]) {
      expect(
        resolveTerminalShortcut(
          { ...base, ctrlKey: false, key },
          { hasSelection: false, selection: "" },
        ),
      ).toEqual({ action: "pass" });
    }
  });

  it("does not claim Ctrl+Enter as a generic workbench chord", () => {
    expect(
      resolveTerminalShortcut(
        { ...base, key: "Enter" },
        { hasSelection: false, selection: "" },
      ),
    ).toEqual({ action: "pass" });
  });

  it("metaKey acts as mod (macOS ⌘)", () => {
    expect(
      resolveTerminalShortcut(
        { ...base, ctrlKey: false, metaKey: true, key: "c" },
        { hasSelection: false, selection: "" },
      ),
    ).toEqual({ action: "sigint" });
  });
});

describe("Ctrl+Enter terminal encoding", () => {
  it("uses native PowerShell CSI-u and quoted newline for readline shells", () => {
    expect(ctrlEnterSequenceForShell("ps")).toBe("\x1b[13;5u");
    expect(ctrlEnterSequenceForShell("ps-pwsh")).toBe("\x1b[13;5u");
    expect(ctrlEnterSequenceForShell("codex")).toBe("\x1b[13;5u");
    expect(ctrlEnterSequenceForShell("codex:default")).toBe("\x1b[13;5u");
    expect(ctrlEnterSequenceForShell("claude")).toBe("\x1b[13;5u");
    expect(ctrlEnterSequenceForShell("claude:opus")).toBe("\x1b[13;5u");
    expect(ctrlEnterSequenceForShell("cmd")).toBeNull();
    for (const shellKey of ["bash", "zsh", "wsl", "wsl:Ubuntu", "ssh:ubuntu-test"]) {
      expect(ctrlEnterSequenceForShell(shellKey)).toBe("\x16\x0a");
    }
  });
});

describe("workbench chords never reach the PTY", () => {
  const none = { hasSelection: false, selection: "" };

  it("Ctrl+T / Ctrl+W / Ctrl+, → workbench", () => {
    for (const key of ["t", "w", ","]) {
      expect(resolveTerminalShortcut({ ...base, key }, none)).toEqual({
        action: "workbench",
      });
    }
  });

  it("Ctrl+Shift+P/A/W/M → workbench", () => {
    for (const key of ["p", "a", "w", "m"]) {
      expect(
        resolveTerminalShortcut({ ...base, key, shiftKey: true }, none),
      ).toEqual({ action: "workbench" });
    }
  });

  it("Alt+Shift+D / Alt+Shift+E (split) → workbench", () => {
    for (const key of ["d", "e"]) {
      expect(
        resolveTerminalShortcut(
          { ...base, ctrlKey: false, altKey: true, shiftKey: true, key },
          none,
        ),
      ).toEqual({ action: "workbench" });
    }
  });

  it("Ctrl+Alt+Arrow (pane focus) → workbench", () => {
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      expect(
        resolveTerminalShortcut({ ...base, altKey: true, key }, none),
      ).toEqual({ action: "workbench" });
    }
  });

  it("Ctrl+Shift+C stays copy (not workbench)", () => {
    expect(
      resolveTerminalShortcut({ ...base, shiftKey: true, key: "c" }, none),
    ).toEqual({ action: "copy", text: "" });
  });

  it("plain Alt+letter still passes to the shell", () => {
    expect(
      resolveTerminalShortcut(
        { ...base, ctrlKey: false, altKey: true, key: "d" },
        none,
      ),
    ).toEqual({ action: "pass" });
  });
});
