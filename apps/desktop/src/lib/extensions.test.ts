import { describe, expect, it, beforeEach } from "vitest";
import {
  EXAMPLE_EXTENSION,
  EXT_STORE_KEY,
  agentSystemFromExtensions,
  allExtensionCommands,
  ensureExampleExtension,
  importExtensionJson,
  loadExtensions,
  setExtensionEnabled,
} from "./extensions";

describe("extensions", () => {
  beforeEach(() => {
    localStorage.removeItem(EXT_STORE_KEY);
  });

  it("loads example by default", () => {
    expect(loadExtensions().some((e) => e.id === EXAMPLE_EXTENSION.id)).toBe(true);
  });

  it("ensureExampleExtension", () => {
    const list = ensureExampleExtension();
    expect(list.some((e) => e.id === EXAMPLE_EXTENSION.id)).toBe(true);
  });

  it("agentSystemFromExtensions respects enabled", () => {
    ensureExampleExtension();
    setExtensionEnabled(EXAMPLE_EXTENSION.id, false);
    expect(agentSystemFromExtensions()).toBe("");
    setExtensionEnabled(EXAMPLE_EXTENSION.id, true);
    expect(agentSystemFromExtensions().length).toBeGreaterThan(10);
  });

  it("allExtensionCommands", () => {
    ensureExampleExtension();
    expect(allExtensionCommands().length).toBeGreaterThan(0);
  });

  it("importExtensionJson", () => {
    importExtensionJson(
      JSON.stringify({
        id: "x.test",
        name: "T",
        version: "1",
        commands: [{ id: "c", label: "L", runCommand: "echo 1" }],
      }),
    );
    expect(loadExtensions().some((e) => e.id === "x.test")).toBe(true);
  });
});
