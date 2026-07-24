import { describe, expect, it, beforeEach } from "vitest";
import {
  CUSTOM_TPL_KEY,
  addCustomTemplate,
  loadCustomTemplates,
  rehydrateLayout,
  deleteCustomTemplate,
} from "./customTemplates";
import { countLeaves, type LeafPane } from "./layout";

const leaf = (id: string, serial: number): LeafPane => ({
  type: "leaf",
  id,
  serial,
  shellKey: "ps",
  cwd: "C:\\",
  history: [{ text: "x" }],
  cmdHistory: ["old"],
  histIdx: 0,
  draft: "d",
  ptyId: "pty-1",
});

describe("customTemplates", () => {
  beforeEach(() => localStorage.removeItem(CUSTOM_TPL_KEY));

  it("add and load", () => {
    addCustomTemplate("T", leaf("a", 1));
    expect(loadCustomTemplates()[0].name).toBe("T");
  });

  it("rehydrate clears runtime fields", () => {
    let id = 1;
    let serial = 10;
    const { layout, activePaneId } = rehydrateLayout(leaf("old", 1), () => `n-${id++}`, () => serial++);
    expect(layout.type).toBe("leaf");
    if (layout.type === "leaf") {
      expect(layout.ptyId).toBeUndefined();
      expect(layout.history).toEqual([]);
      expect(layout.serial).toBe(10);
      expect(activePaneId).toBe(layout.id);
    }
  });

  it("delete", () => {
    const t = addCustomTemplate("X", leaf("a", 1));
    deleteCustomTemplate(t.id);
    expect(loadCustomTemplates()).toHaveLength(0);
  });

  it("split rehydrate leaf count", () => {
    const split = {
      type: "split" as const,
      id: "s",
      dir: "h" as const,
      ratio: 0.5,
      a: leaf("a", 1),
      b: leaf("b", 2),
    };
    let n = 0;
    let s = 1;
    const { layout } = rehydrateLayout(split, () => `i${n++}`, () => s++);
    expect(countLeaves(layout)).toBe(2);
  });
});
