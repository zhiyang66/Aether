import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildSshArgs,
  deleteSshHost,
  loadSshHosts,
  newSshHostId,
  onSshHostsChanged,
  parseSshConfig,
  upsertSshHost,
  type SshHost,
} from "../../lib/sshHosts";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useShellCatalogStore } from "../../store/shellCatalogStore";
import { askConfirm } from "../../components/AppDialog";
import { isTauri } from "../../lib/window";

type Draft = {
  id: string | null;
  name: string;
  host: string;
  port: string;
  user: string;
  identityFile: string;
  jumpHost: string;
  extraArgs: string;
};

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  host: "",
  port: "",
  user: "",
  identityFile: "",
  jumpHost: "",
  extraArgs: "",
});

/** SSH host management (1.0): CRUD + ~/.ssh/config import + connect. */
export function HostsPanel() {
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);
  const createTabFromProfile = useWorkbenchStore((s) => s.createTabFromProfile);
  const [hosts, setHosts] = useState<SshHost[]>(() => loadSshHosts());
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  useEffect(() => onSshHostsChanged(() => setHosts(loadSshHosts())), []);

  const save = () => {
    if (!draft.name.trim() || !draft.host.trim()) {
      toastMsg("名称与主机地址必填");
      return;
    }
    const port = Number(draft.port);
    upsertSshHost({
      id: draft.id ?? newSshHostId(),
      name: draft.name.trim(),
      host: draft.host.trim(),
      port: Number.isFinite(port) && port > 0 ? port : undefined,
      user: draft.user.trim() || undefined,
      identityFile: draft.identityFile.trim() || undefined,
      jumpHost: draft.jumpHost.trim() || undefined,
      extraArgs: draft.extraArgs
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean),
    });
    setDraft(emptyDraft());
    toastMsg(draft.id ? "已更新主机" : "已添加主机（新建标签菜单可见）");
  };

  const connect = (h: SshHost) => {
    const profile = useShellCatalogStore
      .getState()
      .profiles.find((p) => p.id === `ssh:${h.id}`);
    if (profile) {
      createTabFromProfile(profile);
      toastMsg(`正在连接 ${h.name}…（新标签）`);
    } else {
      void useShellCatalogStore
        .getState()
        .scan()
        .then(() => {
          const p = useShellCatalogStore
            .getState()
            .profiles.find((x) => x.id === `ssh:${h.id}`);
          if (p) createTabFromProfile(p);
        });
    }
  };

  const importConfig = async () => {
    if (!isTauri()) {
      toastMsg("导入需要桌面环境");
      return;
    }
    try {
      const text = await invoke<string>("read_ssh_config");
      if (!text.trim()) {
        toastMsg("~/.ssh/config 不存在或为空");
        return;
      }
      const parsed = parseSshConfig(text);
      if (!parsed.length) {
        toastMsg("未解析到主机条目（通配符 Host 已跳过）");
        return;
      }
      const existing = loadSshHosts();
      let n = 0;
      for (const p of parsed) {
        if (existing.some((h) => h.name === p.name)) continue;
        upsertSshHost({ ...p, id: newSshHostId() });
        n++;
      }
      toastMsg(n ? `已导入 ${n} 台主机` : "全部主机已存在，未导入");
    } catch (e) {
      toastMsg(`导入失败: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div className="section">
      <div className="section-title">已保存主机（{hosts.length}）</div>
      <div className="card">
        {hosts.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            暂无主机。添加后出现在新建标签 / 分屏的 Shell 菜单（SSH 分组），
            密钥路径只存本机，不随工作台导出。
          </div>
        )}
        {hosts.map((h) => (
          <div
            key={h.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>{h.name}</div>
              <code style={{ fontSize: 11, color: "var(--muted)" }}>
                ssh {buildSshArgs(h).join(" ")}
              </code>
            </div>
            <button className="btn primary" type="button" onClick={() => connect(h)}>
              连接
            </button>
            <button
              className="btn"
              type="button"
              onClick={() =>
                setDraft({
                  id: h.id,
                  name: h.name,
                  host: h.host,
                  port: h.port ? String(h.port) : "",
                  user: h.user ?? "",
                  identityFile: h.identityFile ?? "",
                  jumpHost: h.jumpHost ?? "",
                  extraArgs: (h.extraArgs ?? []).join(" "),
                })
              }
            >
              编辑
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                void askConfirm(`删除主机「${h.name}」？`, {
                  danger: true,
                  okLabel: "删除",
                }).then((ok) => {
                  if (ok) {
                    deleteSshHost(h.id);
                    toastMsg("已删除主机");
                  }
                });
              }}
            >
              删除
            </button>
          </div>
        ))}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" type="button" onClick={() => void importConfig()}>
            从 ~/.ssh/config 导入
          </button>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>
        {draft.id ? "编辑主机" : "添加主机"}
      </div>
      <div className="card" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="ctrl"
            style={{ flex: 1 }}
            placeholder="名称（如 生产服务器）"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="ctrl mono"
            style={{ flex: 1 }}
            placeholder="主机地址 / IP"
            value={draft.host}
            onChange={(e) => setDraft({ ...draft, host: e.target.value })}
          />
          <input
            className="ctrl"
            style={{ width: 80 }}
            placeholder="端口 22"
            value={draft.port}
            onChange={(e) => setDraft({ ...draft, port: e.target.value })}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="ctrl"
            style={{ width: 140 }}
            placeholder="用户名（可空）"
            value={draft.user}
            onChange={(e) => setDraft({ ...draft, user: e.target.value })}
          />
          <input
            className="ctrl mono"
            style={{ flex: 1 }}
            placeholder="私钥路径（可空，只存本机）"
            value={draft.identityFile}
            onChange={(e) => setDraft({ ...draft, identityFile: e.target.value })}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="ctrl mono"
            style={{ flex: 1 }}
            placeholder="跳板机 -J（可空，如 user@bastion）"
            value={draft.jumpHost}
            onChange={(e) => setDraft({ ...draft, jumpHost: e.target.value })}
          />
          <input
            className="ctrl mono"
            style={{ flex: 1 }}
            placeholder="额外参数（可空，空格分隔）"
            value={draft.extraArgs}
            onChange={(e) => setDraft({ ...draft, extraArgs: e.target.value })}
          />
        </div>
        <div className="btn-row">
          <button className="btn primary" type="button" onClick={save}>
            {draft.id ? "保存修改" : "添加主机"}
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
