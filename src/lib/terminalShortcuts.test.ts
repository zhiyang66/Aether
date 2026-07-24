import { describe, expect, it } from "vitest";
import { resolveTerminalShortcut } from "./terminalShortcuts";

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

  it("metaKey acts as mod (macOS ⌘)", () => {
    expect(
      resolveTerminalShortcut(
        { ...base, ctrlKey: false, metaKey: true, key: "c" },
        { hasSelection: false, selection: "" },
      ),
    ).toEqual({ action: "sigint" });
  });
});
