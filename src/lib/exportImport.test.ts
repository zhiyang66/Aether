import { describe, expect, it } from "vitest";
import { buildExport, parseExport, EXPORT_VERSION } from "./exportImport";
import type { Tab } from "./layout";

const sampleTab = (id: string): Tab => ({
  id,
  title: "t",
  shellKey: "ps",
  activePaneId: "p1",
  layout: {
    type: "leaf",
    id: "p1",
    serial: 1,
    shellKey: "ps",
    cwd: "C:\\",
    history: [],
    cmdHistory: [],
    histIdx: -1,
    draft: "",
  },
});

describe("exportImport", () => {
  it("buildExport strips shape", () => {
    const exp = buildExport({
      tabs: [sampleTab("a")],
      activeTabId: "a",
      activePaneId: "p1",
      nextSerial: 2,
      aiOpen: true,
      aiWidth: 360,
      aiModel: "m",
      aiEffort: "medium",
      agentSessions: [],
      activeAgentSessionId: null,
      settingsJson: JSON.stringify({ aiApiKey: "secret", fontSize: 14 }),
    });
    expect(exp.version).toBe(EXPORT_VERSION);
    expect(exp.app).toBe("aether");
    expect(exp.settings?.aiApiKey).toBe("");
    expect(exp.settings?.fontSize).toBe(14);
  });

  it("parseExport validates", () => {
    expect(() => parseExport("{}")).toThrow();
    const ok = parseExport(
      JSON.stringify({ version: 2, app: "aether", terminal: { tabs: [] } }),
    );
    expect(ok.version).toBe(2);
    // legacy app id still accepted
    expect(
      parseExport(
        JSON.stringify({ version: 2, app: "shell-workbench", terminal: { tabs: [] } }),
      ).app,
    ).toBe("shell-workbench");
  });

});
