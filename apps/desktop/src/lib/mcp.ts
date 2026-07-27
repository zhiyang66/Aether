/**
 * MCP client frontend (1.0): server configs in localStorage, connections and
 * tool calls via the Rust runtime (mcp_host.rs). Connected servers contribute
 * tools to the Agent loop under the namespace `mcp__<server>__<tool>`.
 *
 * Server env values may contain secrets — configs are local-only and are
 * NOT included in workbench export.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./window";

export type McpTransport = "stdio" | "http";

export type McpServer = {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: unknown;
};

export const MCP_KEY = "sw-mcp-v1";

const listeners = new Set<() => void>();

export function onMcpChanged(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function loadMcpServers(): McpServer[] {
  try {
    const raw = localStorage.getItem(MCP_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data)
      ? data.filter(
          (s) =>
            s &&
            typeof s.id === "string" &&
            typeof s.name === "string" &&
            (s.transport === "stdio" || s.transport === "http"),
        )
      : [];
  } catch {
    return [];
  }
}

export function saveMcpServers(list: McpServer[]) {
  localStorage.setItem(MCP_KEY, JSON.stringify(list.slice(0, 20)));
  emit();
}

export function upsertMcpServer(server: McpServer) {
  const list = loadMcpServers();
  const idx = list.findIndex((s) => s.id === server.id);
  if (idx >= 0) list[idx] = server;
  else list.push(server);
  saveMcpServers(list);
}

export function deleteMcpServer(id: string) {
  connectedTools.delete(id);
  saveMcpServers(loadMcpServers().filter((s) => s.id !== id));
}

/** Sanitize a server name into a tool-name-safe segment. */
export function mcpNameKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32) || "server";
}

/** serverId → tools (populated by connectMcpServer; runtime only) */
const connectedTools = new Map<string, McpTool[]>();

export function getConnectedTools(serverId: string): McpTool[] | undefined {
  return connectedTools.get(serverId);
}

export async function connectMcpServer(server: McpServer): Promise<McpTool[]> {
  if (!isTauri()) throw new Error("MCP 需要桌面环境");
  const tools = await invoke<McpTool[]>("mcp_connect", {
    config: {
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command ?? "",
      args: server.args ?? [],
      env: server.env ?? {},
      url: server.url ?? "",
    },
  });
  connectedTools.set(server.id, tools);
  emit();
  return tools;
}

export async function disconnectMcpServer(serverId: string): Promise<void> {
  connectedTools.delete(serverId);
  emit();
  if (!isTauri()) return;
  await invoke("mcp_disconnect", { serverId });
}

export async function callMcpTool(
  serverId: string,
  tool: string,
  args: unknown,
): Promise<string> {
  if (!isTauri()) throw new Error("MCP 需要桌面环境");
  return invoke<string>("mcp_call_tool", { serverId, tool, args });
}

/** Ensure every enabled server is connected (called before agent rounds). */
export async function ensureMcpConnected(): Promise<void> {
  if (!isTauri()) return;
  const list = loadMcpServers().filter((s) => s.enabled);
  for (const s of list) {
    if (connectedTools.has(s.id)) continue;
    try {
      await connectMcpServer(s);
    } catch {
      // Broken server must not block the agent loop; settings panel surfaces it
    }
  }
}

export type McpToolBinding = {
  /** full namespaced tool name: mcp__<serverKey>__<tool> */
  fullName: string;
  serverId: string;
  serverKey: string;
  tool: string;
};

/**
 * OpenAI-style tool defs + name bindings for all connected+enabled servers.
 */
export function buildMcpToolTable(): {
  tools: unknown[];
  bindings: Map<string, McpToolBinding>;
} {
  const tools: unknown[] = [];
  const bindings = new Map<string, McpToolBinding>();
  for (const server of loadMcpServers()) {
    if (!server.enabled) continue;
    const list = connectedTools.get(server.id);
    if (!list) continue;
    const key = mcpNameKey(server.name);
    for (const t of list) {
      const fullName = `mcp__${key}__${t.name}`.slice(0, 64);
      if (bindings.has(fullName)) continue;
      bindings.set(fullName, {
        fullName,
        serverId: server.id,
        serverKey: key,
        tool: t.name,
      });
      tools.push({
        type: "function",
        function: {
          name: fullName,
          description: `[MCP:${server.name}] ${t.description}`.slice(0, 1024),
          parameters: t.inputSchema ?? { type: "object" },
        },
      });
    }
  }
  return { tools, bindings };
}

export function newMcpServerId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
