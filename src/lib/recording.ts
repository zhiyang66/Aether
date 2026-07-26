/**
 * Session recording frontend (1.0): start/stop via Rust (asciinema cast v2
 * written on the backend), plus a cast parser for the in-app player.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./window";

export async function recordStart(
  ptyId: string,
  cols?: number,
  rows?: number,
): Promise<string> {
  if (!isTauri()) throw new Error("录制需要桌面环境");
  return invoke<string>("pty_record_start", { id: ptyId, cols, rows });
}

export async function recordStop(ptyId: string): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("pty_record_stop", { id: ptyId });
}

export async function recordStatus(ptyId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("pty_record_status", { id: ptyId });
}

export async function readCastFile(path: string): Promise<string> {
  if (!isTauri()) throw new Error("需要桌面环境");
  return invoke<string>("read_cast_file", { path });
}

export type CastEvent = {
  t: number;
  code: "o" | "r" | string;
  data: string;
};

export type Cast = {
  width: number;
  height: number;
  events: CastEvent[];
  /** total duration in seconds */
  duration: number;
};

/** Parse asciinema cast v2 text. Throws on malformed header. */
export function parseCast(text: string): Cast {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("空录像文件");
  let header: { version?: number; width?: number; height?: number };
  try {
    header = JSON.parse(lines[0]);
  } catch {
    throw new Error("录像头部不是合法 JSON");
  }
  if (header.version !== 2) throw new Error(`不支持的 cast 版本: ${header.version}`);
  const events: CastEvent[] = [];
  for (const line of lines.slice(1)) {
    try {
      const arr = JSON.parse(line);
      if (Array.isArray(arr) && typeof arr[0] === "number" && typeof arr[1] === "string") {
        events.push({ t: arr[0], code: arr[1], data: String(arr[2] ?? "") });
      }
    } catch {
      // tolerate truncated tail lines
    }
  }
  return {
    width: header.width || 80,
    height: header.height || 24,
    events,
    duration: events.length ? events[events.length - 1].t : 0,
  };
}
