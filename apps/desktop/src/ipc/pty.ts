import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "../lib/window";

export async function ptyCreate(opts: {
  shellKey: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  path?: string;
  args?: string[];
  /** OSC 133/7 shell integration at spawn (default true on backend) */
  integration?: boolean;
}): Promise<string> {
  if (!isTauri()) throw new Error("not in tauri");
  return invoke<string>("pty_create", {
    args: {
      shell_key: opts.shellKey,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      path: opts.path,
      args: opts.args,
      integration: opts.integration,
    },
  });
}

export async function ptyWrite(id: string, data: string) {
  if (!isTauri()) return;
  await invoke("pty_write", { id, data });
}

export async function ptyResize(id: string, cols: number, rows: number) {
  if (!isTauri()) return;
  await invoke("pty_resize", { id, cols, rows });
}

export async function ptyClose(id: string) {
  if (!isTauri()) return;
  await invoke("pty_close", { id });
}

export async function onPtyData(
  cb: (ev: { id: string; data: number[] | Uint8Array }) => void,
): Promise<UnlistenFn> {
  return listen<{ id: string; data: number[] }>("pty://data", (e) => cb(e.payload));
}

export async function onPtyExit(
  cb: (ev: { id: string; code: number | null }) => void,
): Promise<UnlistenFn> {
  return listen<{ id: string; code: number | null }>("pty://exit", (e) => cb(e.payload));
}

export type ShellScanRow = {
  id: string;
  name: string;
  shell_key: string;
  path: string;
  args: string[];
  available: boolean;
  short?: string;
  desc?: string;
};

export async function shellScan() {
  if (!isTauri()) return [];
  return invoke<ShellScanRow[]>("shell_scan");
}

export type ModelInfo = { id: string; label: string };

function normalizeModelsPayload(data: unknown): ModelInfo[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: unknown[] }).data
      : [];
  return list
    .map((m) => {
      if (typeof m === "string") return { id: m, label: m };
      if (!m || typeof m !== "object") return { id: "", label: "" };
      const o = m as {
        id?: string;
        display_name?: string;
        name?: string;
        label?: string;
      };
      const id = o.id || "";
      const label = o.display_name || o.name || o.label || id;
      return { id, label };
    })
    .filter((m) => m.id);
}

/** Prefer Tauri Rust proxy (avoids CORS). Falls back to browser fetch. */
export async function agentModelsList(
  endpoint: string,
  apiKey: string,
  provider?: string,
): Promise<ModelInfo[]> {
  const ep = endpoint.trim().replace(/\/$/, "");
  if (!ep) throw new Error("请填写 API 端点");

  if (isTauri()) {
    // Single field names only — avoid serde "duplicate field apiKey"
    return invoke<ModelInfo[]>("agent_models_list", {
      req: {
        endpoint: ep,
        apiKey: apiKey?.trim() || null,
        provider: provider || null,
      },
    });
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey.trim()}`;
  const url = ep.endsWith("/models") ? ep : `${ep}/models`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${t ? `: ${t.slice(0, 120)}` : ""}`);
  }
  const data = await res.json();
  const models = normalizeModelsPayload(data);
  if (!models.length) throw new Error("响应中没有模型");
  return models;
}

export async function agentChat(req: {
  endpoint: string;
  apiKey?: string;
  provider?: string;
  model: string;
  messages: { role: string; content: string }[];
  streamId: string;
}) {
  if (!isTauri()) throw new Error("agent chat requires tauri for streaming proxy");
  // IMPORTANT: only one casing per field — serde rename_all + alias rejects duplicates
  return invoke("agent_chat", {
    req: {
      endpoint: req.endpoint.trim().replace(/\/$/, ""),
      apiKey: req.apiKey?.trim() || null,
      provider: req.provider || null,
      model: req.model,
      messages: req.messages,
      streamId: req.streamId,
    },
  });
}

/** Abort an in-flight agent_chat stream (Stop button). Returns true if stream was known. */
export async function agentChatCancel(streamId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("agent_chat_cancel", { streamId });
}
