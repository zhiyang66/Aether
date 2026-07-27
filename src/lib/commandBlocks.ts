/**
 * Command blocks (OSC 133): per-pane runtime store of structured
 * command + exit code + timing, driven by shell-integration marks.
 *
 * Marks: A = prompt start, B = prompt end / input start, C = pre-exec,
 * D;<exit> = finished. Blocks live only in memory (xterm markers die with
 * the terminal); persistence stays with outputSnapshot.
 */

import type { IMarker } from "@xterm/xterm";

export type CommandBlock = {
  id: string;
  paneId: string;
  /** Last submitted command line (captured from input buffer at C-mark). */
  command: string;
  exitCode: number | null;
  running: boolean;
  startedAt: number;
  endedAt: number | null;
  cwd: string | null;
  /** xterm marker at the command's first line (may become disposed). */
  marker: IMarker | null;
  /** marker at the D mark (end of output). */
  endMarker: IMarker | null;
};

export type BlockListener = (paneId: string) => void;

const MAX_BLOCKS_PER_PANE = 100;

const blocksByPane = new Map<string, CommandBlock[]>();
const listeners = new Set<BlockListener>();
let seq = 0;

function emit(paneId: string) {
  for (const l of listeners) {
    try {
      l(paneId);
    } catch {
      /* ignore */
    }
  }
}

export function onBlocksChanged(l: BlockListener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getBlocks(paneId: string): CommandBlock[] {
  return blocksByPane.get(paneId) ?? [];
}

export function lastBlock(paneId: string): CommandBlock | undefined {
  const list = blocksByPane.get(paneId);
  return list?.[list.length - 1];
}

export function clearBlocks(paneId: string) {
  const list = blocksByPane.get(paneId);
  if (list) {
    for (const b of list) {
      try {
        b.marker?.dispose();
        b.endMarker?.dispose();
      } catch {
        /* ignore */
      }
    }
  }
  blocksByPane.delete(paneId);
  emit(paneId);
}

/**
 * Per-pane OSC 133 mark tracker. Feed marks from the xterm OSC handler.
 * `now` is injectable for tests.
 */
export class BlockTracker {
  private paneId: string;
  private pendingCommand = "";
  private now: () => number;

  constructor(paneId: string, now: () => number = () => Date.now()) {
    this.paneId = paneId;
    this.now = now;
  }

  /** Frontend captured a submitted command line (from the input buffer). */
  noteSubmittedCommand(cmd: string) {
    const t = cmd.trim();
    if (t) this.pendingCommand = t;
  }

  /** OSC 133 payload, e.g. "A", "B", "C", "D;0". Returns finished block on D. */
  handleMark(
    payload: string,
    ctx: { marker: () => IMarker | null; cwd: () => string | null },
  ): CommandBlock | null {
    const kind = payload[0]?.toUpperCase();
    if (kind === "C") {
      const list = blocksByPane.get(this.paneId) ?? [];
      // Ignore duplicate C without a D in between (nested integrations)
      const last = list[list.length - 1];
      if (last?.running) return null;
      const block: CommandBlock = {
        id: `blk-${++seq}`,
        paneId: this.paneId,
        command: this.pendingCommand,
        exitCode: null,
        running: true,
        startedAt: this.now(),
        endedAt: null,
        cwd: ctx.cwd(),
        marker: ctx.marker(),
        endMarker: null,
      };
      this.pendingCommand = "";
      list.push(block);
      if (list.length > MAX_BLOCKS_PER_PANE) {
        const dropped = list.splice(0, list.length - MAX_BLOCKS_PER_PANE);
        for (const d of dropped) {
          try {
            d.marker?.dispose();
            d.endMarker?.dispose();
          } catch {
            /* ignore */
          }
        }
      }
      blocksByPane.set(this.paneId, list);
      emit(this.paneId);
      return null;
    }
    if (kind === "D") {
      const list = blocksByPane.get(this.paneId);
      const last = list?.[list.length - 1];
      // D without running block = prompt redraw / foreign integration → ignore
      if (!last || !last.running) return null;
      const exitRaw = payload.split(";")[1];
      const exit = exitRaw != null && exitRaw !== "" ? Number(exitRaw) : null;
      last.running = false;
      last.exitCode = Number.isFinite(exit as number) ? (exit as number) : null;
      last.endedAt = this.now();
      last.endMarker = ctx.marker();
      emit(this.paneId);
      return last;
    }
    // A / B need no block bookkeeping (prompt boundaries)
    return null;
  }
}

/**
 * Read a block's output text from the live xterm buffer (between the C-mark
 * line and the D-mark line). Markers may be gone after clear/trim — returns
 * null then and callers fall back to pane output snapshots.
 */
export function readBlockOutput(
  term: import("@xterm/xterm").Terminal,
  block: CommandBlock,
  maxLines = 200,
): string | null {
  const start = block.marker && !block.marker.isDisposed ? block.marker.line : null;
  if (start == null) return null;
  const end =
    block.endMarker && !block.endMarker.isDisposed
      ? block.endMarker.line
      : term.buffer.active.baseY + term.buffer.active.cursorY;
  const lines: string[] = [];
  const from = Math.max(start, end - maxLines);
  for (let i = from; i <= end; i++) {
    const line = term.buffer.active.getLine(i);
    if (!line) continue;
    lines.push(line.translateToString(true));
  }
  // Trim trailing empty lines
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

/** Summary for Agent context / diagnosis: command, exit, duration, cwd. */
export function blockHeader(b: CommandBlock): string {
  const dur = b.endedAt ? formatDuration(b.endedAt - b.startedAt) : "运行中";
  const exit = b.running ? "…" : String(b.exitCode ?? "?");
  return `$ ${b.command || "（未捕获命令）"} [exit=${exit} · ${dur}${b.cwd ? ` · ${b.cwd}` : ""}]`;
}
