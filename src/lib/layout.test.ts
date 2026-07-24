import { describe, expect, it } from "vitest";
import {
  collectLeaves,
  countLeaves,
  findLeaf,
  findLeafBySerial,
  makePane,
  removeLeaf,
  splitLeaf,
  layoutSummary,
  updateSplitRatio,
} from "./layout";
import type { LeafPane } from "./layout";

let id = 1;
const nextId = () => `p-${id++}`;
const nextSerial = (() => {
  let s = 1;
  return () => s++;
})();

function leaf(shell: "ps" | "bash" = "ps"): LeafPane {
  return makePane(shell, nextId, nextSerial);
}

describe("layout tree", () => {
  it("makePane creates leaf with serial", () => {
    id = 1;
    const p = leaf();
    expect(p.type).toBe("leaf");
    expect(p.serial).toBeGreaterThan(0);
    expect(p.shellKey).toBe("ps");
  });

  it("splitLeaf splits focus leaf 50%", () => {
    id = 1;
    const a = leaf();
    const b = leaf();
    const root = splitLeaf(a, a.id, "h", b, () => "split-1");
    expect(root.type).toBe("split");
    if (root.type !== "split") return;
    expect(root.dir).toBe("h");
    expect(root.ratio).toBe(0.5);
    expect(countLeaves(root)).toBe(2);
    expect(layoutSummary(root)).toMatch(/#\d+ \| #\d+/);
  });

  it("removeLeaf collapses sibling", () => {
    id = 1;
    const a = leaf();
    const b = leaf();
    let root = splitLeaf(a, a.id, "h", b, () => "s1");
    const res = removeLeaf(root, a.id);
    expect(res).not.toBeNull();
    expect(res!.root?.type).toBe("leaf");
    expect((res!.root as LeafPane).id).toBe(b.id);
  });

  it("findLeaf / findLeafBySerial", () => {
    id = 1;
    const a = leaf();
    const b = leaf();
    const root = splitLeaf(a, a.id, "v", b, () => "s2");
    expect(findLeaf(root, b.id)?.id).toBe(b.id);
    expect(findLeafBySerial(root, b.serial)?.id).toBe(b.id);
    expect(findLeafBySerial(root, 9999)).toBeNull();
  });

  it("nested split layoutSummary", () => {
    id = 1;
    const a = leaf();
    const b = leaf();
    const c = leaf();
    let root = splitLeaf(a, a.id, "h", b, () => "s1");
    root = splitLeaf(root, b.id, "v", c, () => "s2");
    expect(countLeaves(root)).toBe(3);
    expect(collectLeaves(root)).toHaveLength(3);
    const summary = layoutSummary(root);
    expect(summary).toContain("|");
    expect(summary).toContain("/");
  });

  it("updateSplitRatio", () => {
    id = 1;
    const a = leaf();
    const b = leaf();
    const root = splitLeaf(a, a.id, "h", b, () => "split-x");
    const next = updateSplitRatio(root, "split-x", 0.3);
    expect(next.type).toBe("split");
    if (next.type === "split") expect(next.ratio).toBe(0.3);
  });
});
