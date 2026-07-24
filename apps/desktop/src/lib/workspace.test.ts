import { describe, expect, it, beforeEach } from "vitest";
import {
  deleteWorkspace,
  emptyWorkspaceStore,
  loadWorkspaces,
  upsertWorkspace,
  WORKSPACE_STORE_KEY,
} from "./workspace";

describe("workspace store", () => {
  beforeEach(() => {
    localStorage.removeItem(WORKSPACE_STORE_KEY);
  });

  it("upsert and load", () => {
    const ws = {
      id: "w1",
      name: "Demo",
      createdAt: "t",
      updatedAt: "t",
      tabs: [],
      activeTabId: null,
      activePaneId: null,
      nextSerial: 1,
    };
    upsertWorkspace(ws);
    const store = loadWorkspaces();
    expect(store.workspaces).toHaveLength(1);
    expect(store.activeId).toBe("w1");
  });

  it("delete workspace", () => {
    upsertWorkspace({
      id: "a",
      name: "A",
      createdAt: "t",
      updatedAt: "t",
      tabs: [],
      activeTabId: null,
      activePaneId: null,
      nextSerial: 1,
    });
    upsertWorkspace({
      id: "b",
      name: "B",
      createdAt: "t",
      updatedAt: "t",
      tabs: [],
      activeTabId: null,
      activePaneId: null,
      nextSerial: 1,
    });
    deleteWorkspace("b");
    expect(loadWorkspaces().workspaces.map((w) => w.id)).toEqual(["a"]);
  });

  it("empty store", () => {
    expect(emptyWorkspaceStore().workspaces).toEqual([]);
  });
});
