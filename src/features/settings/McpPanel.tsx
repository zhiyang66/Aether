import { useEffect, useState } from "react";
import {
  connectMcpServer,
  deleteMcpServer,
  disconnectMcpServer,
  getConnectedTools,
  loadMcpServers,
  newMcpServerId,
  onMcpChanged,
  upsertMcpServer,
  type McpServer,
} from "../../lib/mcp";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { askConfirm } from "../../components/AppDialog";
import { isTauri } from "../../lib/window";

type Draft = {
  id: string | null;
  name: string;
  transport: "stdio" | "http";
  commandLine: string;
  env: string;
  url: string;
};

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  transport: "stdio",
  commandLine: "",
  env: "",
  url: "",
});

function splitCommandLine(line: string): { command: string; args: string[] } {
  const parts = line.match(/"[^"]*"|\S+/g) ?? [];
  const clean = parts.map((p) => p.replace(/^"|"$/g, ""));
  return { command: clean[0] ?? "", args: clean.slice(1) };
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/** MCP server management (1.0): add / connect / preview tools / delete. */
export function McpPanel() {
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);
  const [servers, setServers] = useState<McpServer[]>(() => loadMcpServers());
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(
    () =>
      onMcpChanged(() => {
        setServers(loadMcpServers());
        setTick((v) => v + 1);
      }),
    [],
  );

  const addServer = async () => {
    if (!draft.name.trim()) {
      toastMsg("请填写 server 名称");
      return;
    }
    const { command, args } = splitCommandLine(draft.commandLine);
    if (draft.transport === "stdio" && !command) {
      toastMsg("stdio 需要启动命令");
      return;
    }
    if (draft.transport === "http" && !draft.url.trim()) {
      toastMsg("http 需要 URL");
      return;
    }
    // 防"配置即执行"：添加本地进程 server 必须明示命令行并确认
    if (draft.transport === "stdio" && !draft.id) {
      const ok = await askConfirm("添加 MCP server 将执行本地进程", {
        message: `启动命令：\n${draft.commandLine}\n\n确认这是你信任的程序？`,
        danger: true,
        okLabel: "确认添加",
      });
      if (!ok) return;
    }
    upsertMcpServer({
      id: draft.id ?? newMcpServerId(),
      name: draft.name.trim(),
      transport: draft.transport,
      command,
      args,
      env: parseEnv(draft.env),
      url: draft.url.trim(),
      enabled: true,
    });
    setDraft(emptyDraft());
    toastMsg(draft.id ? "已更新 server" : "已添加 server（可点连接测试）");
  };

  const connect = async (s: McpServer) => {
    setBusy(s.id);
    try {
      const tools = await connectMcpServer(s);
      toastMsg(`已连接 ${s.name} · ${tools.length} 个工具`);
    } catch (e) {
      toastMsg(`连接失败: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="section">
      {!isTauri() && (
        <div className="card" style={{ color: "var(--muted)", fontSize: 13 }}>
          MCP 需要桌面环境（浏览器预览下不可用）。
        </div>
      )}
      <div className="section-title">已配置（{servers.length}）</div>
      <div className="card">
        {servers.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            暂无 MCP server。连接后其工具自动加入 Agent 工具表（命名空间
            mcp__名称__工具），调用受「审批」策略管控。
          </div>
        )}
        {servers.map((s) => {
          const tools = getConnectedTools(s.id);
          return (
            <div
              key={s.id}
              style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={`status-pill${tools ? " ok" : ""}`}>
                  {tools ? `已连接 · ${tools.length} 工具` : "未连接"}
                </span>
                <strong style={{ fontSize: 13 }}>{s.name}</strong>
                <code
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 11,
                    color: "var(--muted)",
                  }}
                >
                  {s.transport === "http"
                    ? s.url
                    : `${s.command} ${(s.args ?? []).join(" ")}`}
                </code>
                <label
                  style={{
                    fontSize: 12,
                    display: "inline-flex",
                    gap: 4,
                    alignItems: "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => {
                      upsertMcpServer({ ...s, enabled: e.target.checked });
                      if (!e.target.checked) void disconnectMcpServer(s.id);
                    }}
                  />
                  启用
                </label>
                <button
                  className="btn"
                  type="button"
                  disabled={busy === s.id || !isTauri()}
                  onClick={() => void connect(s)}
                >
                  {busy === s.id ? "连接中…" : tools ? "重连" : "连接"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    setDraft({
                      id: s.id,
                      name: s.name,
                      transport: s.transport,
                      commandLine: [s.command, ...(s.args ?? [])]
                        .filter(Boolean)
                        .join(" "),
                      env: Object.entries(s.env ?? {})
                        .map(([k, v]) => `${k}=${v}`)
                        .join("\n"),
                      url: s.url ?? "",
                    })
                  }
                >
                  编辑
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    void askConfirm(`删除 MCP server「${s.name}」？`, {
                      danger: true,
                      okLabel: "删除",
                    }).then((ok) => {
                      if (ok) {
                        void disconnectMcpServer(s.id);
                        deleteMcpServer(s.id);
                        toastMsg("已删除");
                      }
                    });
                  }}
                >
                  删除
                </button>
              </div>
              {tools && tools.length > 0 && (
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                  }}
                >
                  {tools.slice(0, 12).map((t) => (
                    <code
                      key={t.name}
                      title={t.description}
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        color: "var(--muted)",
                      }}
                    >
                      {t.name}
                    </code>
                  ))}
                  {tools.length > 12 && (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      +{tools.length - 12}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>
        {draft.id ? "编辑 server" : "添加 server"}
      </div>
      <div className="card" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="ctrl"
            style={{ flex: 1 }}
            placeholder="名称（如 filesystem）"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <select
            className="ctrl"
            style={{ width: 110 }}
            value={draft.transport}
            onChange={(e) =>
              setDraft({ ...draft, transport: e.target.value as "stdio" | "http" })
            }
          >
            <option value="stdio">stdio 本地</option>
            <option value="http">http 远程</option>
          </select>
        </div>
        {draft.transport === "stdio" ? (
          <>
            <input
              className="ctrl mono"
              placeholder='启动命令行，如 npx -y "@modelcontextprotocol/server-filesystem" D:\proj'
              value={draft.commandLine}
              onChange={(e) => setDraft({ ...draft, commandLine: e.target.value })}
            />
            <textarea
              className="ctrl mono"
              rows={2}
              placeholder={"环境变量（每行 KEY=VALUE，可空；密钥只存本机）"}
              value={draft.env}
              onChange={(e) => setDraft({ ...draft, env: e.target.value })}
            />
          </>
        ) : (
          <input
            className="ctrl mono"
            placeholder="https://example.com/mcp"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
        )}
        <div className="btn-row">
          <button className="btn primary" type="button" onClick={() => void addServer()}>
            {draft.id ? "保存修改" : "添加"}
          </button>
          {draft.id && (
            <button className="btn" type="button" onClick={() => setDraft(emptyDraft())}>
              取消编辑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
