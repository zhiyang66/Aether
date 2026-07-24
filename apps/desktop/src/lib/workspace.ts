/**
 * Named workspaces — V2.0 major capability.
 * A workspace captures terminal layout snapshot + defaults.
 */

import type { Tab } from "./layout";

export const WORKSPACE_STORE_KEY = "sw-workspaces-v1";

export type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  defaultShell?: string;
  defaultCwd?: string;
  defaultModelId?: string;
  /** serialized terminal session fragment */
  tabs: Tab[];
  activeTabId: string | null;
  activePaneId: string | null;
  nextSerial: number;
  aiOpen?: boolean;
  aiWidth?: number;
  notes?: string;
};

export type WorkspaceStore = {
  version: 1;
  activeId: string | null;
  workspaces: Workspace[];
};

export function emptyWorkspaceStore(): WorkspaceStore {
  return { version: 1, activeId: null, workspaces: [] };
}

export function loadWorkspaces(): WorkspaceStore {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORE_KEY);
    if (!raw) return emptyWorkspaceStore();
    const data = JSON.parse(raw) as WorkspaceStore;
    if (!data.workspaces) return emptyWorkspaceStore();
    return data;
  } catch {
    return emptyWorkspaceStore();
  }
}

export function saveWorkspaces(store: WorkspaceStore) {
  localStorage.setItem(WORKSPACE_STORE_KEY, JSON.stringify(store));
}

export function upsertWorkspace(ws: Workspace) {
  const store = loadWorkspaces();
  const i = store.workspaces.findIndex((w) => w.id === ws.id);
  if (i >= 0) store.workspaces[i] = ws;
  else store.workspaces.unshift(ws);
  store.activeId = ws.id;
  saveWorkspaces(store);
  return store;
}

export function deleteWorkspace(id: string) {
  const store = loadWorkspaces();
  store.workspaces = store.workspaces.filter((w) => w.id !== id);
  if (store.activeId === id) store.activeId = store.workspaces[0]?.id ?? null;
  saveWorkspaces(store);
  return store;
}

export function getWorkspace(id: string): Workspace | null {
  return loadWorkspaces().workspaces.find((w) => w.id === id) ?? null;
}
