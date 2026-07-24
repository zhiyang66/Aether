import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES, getTemplate } from "./layoutTemplates";
import { countLeaves } from "./layout";

describe("layoutTemplates", () => {
  it("has builtins", () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(getTemplate("edit-build-log")?.name).toContain("日志");
  });

  it("build edit-build-log has 3 leaves", () => {
    let id = 1;
    let serial = 1;
    const t = getTemplate("edit-build-log")!;
    const { layout, activePaneId } = t.build({
      nextId: () => `id-${id++}`,
      nextSerial: () => serial++,
      shellKey: "ps",
      cwd: "C:\\",
    });
    expect(countLeaves(layout)).toBe(3);
    expect(activePaneId).toBeTruthy();
  });
});
