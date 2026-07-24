import type { AgentChatSession } from "./workbenchStore";
import type { Tab } from "../lib/layout";

const SESSION_KEY = "sw-terminal-session-v1";
const AGENT_KEY = "sw-agent-sessions-v1";

export function saveTerminalSession(payload: {
  tabs: Tab[];
  activeTabId: string | null;
  activePaneId: string | null;
  nextSerial: number;
  aiOpen: boolean;
  aiWidth: number;
  aiModel: string;
  aiEffort: string;
}) {
  try {
    // Strip runtime pty ids / huge history for storage
    const tabs = payload.tabs.map((t) => ({
      ...t,
      layout: stripPty(t.layout),
    }));
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...payload, tabs }));
  } catch {
    /* quota */
  }
}

function stripPty(node: Tab["layout"]): Tab["layout"] {
  if (node.type === "leaf") {
    return { ...node, ptyId: undefined, history: node.history.slice(-50) };
  }
  return {
    ...node,
    a: stripPty(node.a),
    b: stripPty(node.b),
  };
}

export function loadTerminalSession(): {
  tabs: Tab[];
  activeTabId: string | null;
  activePaneId: string | null;
  nextSerial: number;
  aiOpen: boolean;
  aiWidth: number;
  aiModel: string;
  aiEffort: string;
} | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveAgentSessions(
  sessions: AgentChatSession[],
  activeId: string | null,
) {
  try {
    localStorage.setItem(AGENT_KEY, JSON.stringify({ sessions, activeId }));
  } catch {
    /* ignore */
  }
}

export function loadAgentSessions(): {
  sessions: AgentChatSession[];
  activeId: string | null;
} | null {
  try {
    const raw = localStorage.getItem(AGENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
