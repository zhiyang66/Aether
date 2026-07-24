import type { Tab } from "./layout";
import type { AgentChatSession } from "../store/workbenchStore";

export const EXPORT_VERSION = 2;

export type WorkbenchExport = {
  version: number;
  exportedAt: string;
  app: "aether" | "shell-workbench";
  terminal?: {
    tabs: Tab[];
    activeTabId: string | null;
    activePaneId: string | null;
    nextSerial: number;
    aiOpen: boolean;
    aiWidth: number;
    aiModel: string;
    aiEffort: string;
  };
  agent?: {
    sessions: AgentChatSession[];
    activeId: string | null;
  };
  settings?: Record<string, unknown>;
};

export function buildExport(data: {
  tabs: Tab[];
  activeTabId: string | null;
  activePaneId: string | null;
  nextSerial: number;
  aiOpen: boolean;
  aiWidth: number;
  aiModel: string;
  aiEffort: string;
  agentSessions: AgentChatSession[];
  activeAgentSessionId: string | null;
  settingsJson?: string | null;
}): WorkbenchExport {
  let settings: Record<string, unknown> | undefined;
  try {
    if (data.settingsJson) settings = JSON.parse(data.settingsJson) as Record<string, unknown>;
  } catch {
    settings = undefined;
  }
  // Never export api key if present
  if (settings && "aiApiKey" in settings) {
    settings = { ...settings, aiApiKey: "" };
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: "aether",
    terminal: {
      tabs: data.tabs,
      activeTabId: data.activeTabId,
      activePaneId: data.activePaneId,
      nextSerial: data.nextSerial,
      aiOpen: data.aiOpen,
      aiWidth: data.aiWidth,
      aiModel: data.aiModel,
      aiEffort: data.aiEffort,
    },
    agent: {
      sessions: data.agentSessions,
      activeId: data.activeAgentSessionId,
    },
    settings,
  };
}

export function parseExport(raw: string): WorkbenchExport {
  const data = JSON.parse(raw) as WorkbenchExport;
  if (!data || (data.app !== "aether" && data.app !== "shell-workbench")) {
    throw new Error("不是 Aether 导出文件");
  }
  if (typeof data.version !== "number") {
    throw new Error("导出文件缺少 version");
  }
  return data;
}

export function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function reorderTabs<T extends { id: string }>(tabs: T[], fromId: string, toId: string): T[] {
  if (fromId === toId) return tabs;
  const from = tabs.findIndex((t) => t.id === fromId);
  const to = tabs.findIndex((t) => t.id === toId);
  if (from < 0 || to < 0) return tabs;
  const next = [...tabs];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
