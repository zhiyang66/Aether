import { describe, expect, it } from "vitest";
import type { IMarker } from "@xterm/xterm";
import {
  BlockTracker,
  blockHeader,
  clearBlocks,
  formatDuration,
  getBlocks,
  lastBlock,
  onBlocksChanged,
} from "./commandBlocks";

function fakeMarker(line: number): IMarker {
  return {
    line,
    id: line,
    isDisposed: false,
    dispose() {
      (this as { isDisposed: boolean }).isDisposed = true;
    },
    onDispose: () => ({ dispose() {} }),
  } as unknown as IMarker;
}

const ctx = (line = 1, cwd: string | null = "/home") => ({
  marker: () => fakeMarker(line),
  cwd: () => cwd,
});

describe("BlockTracker lifecycle", () => {
  it("C creates a running block, D finishes it with exit code", () => {
    const pane = "p-life";
    let t = 1000;
    const tr = new BlockTracker(pane, () => t);
    tr.noteSubmittedCommand("npm test");
    tr.handleMark("C", ctx(3));
    let b = lastBlock(pane)!;
    expect(b.running).toBe(true);
    expect(b.command).toBe("npm test");
    expect(b.cwd).toBe("/home");

    t = 3500;
    const done = tr.handleMark("D;1", ctx(9));
    b = lastBlock(pane)!;
    expect(done).toBe(b);
    expect(b.running).toBe(false);
    expect(b.exitCode).toBe(1);
    expect(b.endedAt! - b.startedAt).toBe(2500);
    clearBlocks(pane);
  });

  it("ignores D without a running block (prompt redraw / foreign integration)", () => {
    const pane = "p-noise";
    const tr = new BlockTracker(pane, () => 0);
    expect(tr.handleMark("D;0", ctx())).toBeNull();
    expect(getBlocks(pane)).toHaveLength(0);
    clearBlocks(pane);
  });

  it("ignores duplicate C while a block is running (nested integrations)", () => {
    const pane = "p-dup";
    const tr = new BlockTracker(pane, () => 0);
    tr.noteSubmittedCommand("a");
    tr.handleMark("C", ctx());
    tr.noteSubmittedCommand("b");
    tr.handleMark("C", ctx());
    expect(getBlocks(pane)).toHaveLength(1);
    expect(getBlocks(pane)[0].command).toBe("a");
    clearBlocks(pane);
  });

  it("D without exit payload → exitCode null", () => {
    const pane = "p-noexit";
    const tr = new BlockTracker(pane, () => 0);
    tr.handleMark("C", ctx());
    tr.handleMark("D", ctx());
    expect(lastBlock(pane)!.exitCode).toBeNull();
    clearBlocks(pane);
  });

  it("A/B marks do not create blocks", () => {
    const pane = "p-ab";
    const tr = new BlockTracker(pane, () => 0);
    tr.handleMark("A", ctx());
    tr.handleMark("B", ctx());
    expect(getBlocks(pane)).toHaveLength(0);
    clearBlocks(pane);
  });

  it("notifies listeners and clearBlocks empties the pane", () => {
    const pane = "p-listen";
    const tr = new BlockTracker(pane, () => 0);
    const events: string[] = [];
    const off = onBlocksChanged((pid) => events.push(pid));
    tr.handleMark("C", ctx());
    tr.handleMark("D;0", ctx());
    expect(events.filter((p) => p === pane).length).toBeGreaterThanOrEqual(2);
    clearBlocks(pane);
    expect(getBlocks(pane)).toHaveLength(0);
    off();
  });
});

describe("helpers", () => {
  it("formatDuration renders ms / s / m", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(2500)).toBe("2.5s");
    expect(formatDuration(65_000)).toBe("1m5s");
  });

  it("blockHeader includes command, exit and duration", () => {
    const pane = "p-header";
    let t = 0;
    const tr = new BlockTracker(pane, () => t);
    tr.noteSubmittedCommand("cargo build");
    tr.handleMark("C", ctx(0, "D:/proj"));
    t = 1200;
    tr.handleMark("D;0", ctx());
    const h = blockHeader(lastBlock(pane)!);
    expect(h).toContain("cargo build");
    expect(h).toContain("exit=0");
    expect(h).toContain("1.2s");
    expect(h).toContain("D:/proj");
    clearBlocks(pane);
  });
});
