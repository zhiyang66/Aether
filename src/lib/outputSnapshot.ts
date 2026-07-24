/**
 * Terminal output snapshot persistence — V2.0 major (optional).
 */

import { getPaneOutput } from "./paneRegistry";

const KEY = "sw-output-snapshots-v1";

export type SnapshotStore = {
  enabled: boolean;
  maxLines: number;
  /** paneId -> lines */
  panes: Record<string, string[]>;
};

export function loadSnapshotStore(): SnapshotStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { enabled: false, maxLines: 200, panes: {} };
    return JSON.parse(raw) as SnapshotStore;
  } catch {
    return { enabled: false, maxLines: 200, panes: {} };
  }
}

export function saveSnapshotStore(s: SnapshotStore) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function captureSnapshots(paneIds: string[], maxLines = 200) {
  const s = loadSnapshotStore();
  if (!s.enabled) return;
  for (const id of paneIds) {
    const text = getPaneOutput(id, maxLines);
    s.panes[id] = text ? text.split("\n").slice(-maxLines) : [];
  }
  s.maxLines = maxLines;
  saveSnapshotStore(s);
}

export function restoreSnapshot(paneId: string): string {
  const s = loadSnapshotStore();
  if (!s.enabled) return "";
  return (s.panes[paneId] || []).join("\n");
}
