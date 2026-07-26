import { useEffect, useState } from "react";
import {
  deleteSnippet,
  exportSnippetsJson,
  extractParams,
  importSnippetsJson,
  loadSnippets,
  newSnippetId,
  onSnippetsChanged,
  upsertSnippet,
  type Snippet,
} from "../../lib/snippets";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { askConfirm } from "../../components/AppDialog";

type Draft = {
  id: string | null;
  name: string;
  template: string;
  defaults: Record<string, string>;
  shellKeys: string;
  tags: string;
};

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  template: "",
  defaults: {},
  shellKeys: "",
  tags: "",
});

/** Settings panel: snippet CRUD + JSON import/export (0.9 效率层). */
export function SnippetsPanel() {
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);
  const [list, setList] = useState<Snippet[]>(() => loadSnippets());
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  useEffect(() => onSnippetsChanged(() => setList(loadSnippets())), []);

  const paramNames = extractParams(draft.template);

  const saveDraft = () => {
    if (!draft.name.trim() || !draft.template.trim()) {
      toastMsg("名称与模板必填");
      return;
    }
    upsertSnippet({
      id: draft.id ?? newSnippetId(),
      name: draft.name.trim(),
      template: draft.template,
      params: paramNames.map((n) => ({
        name: n,
        default: draft.defaults[n] || undefined,
      })),
      shellKeys: draft.shellKeys
        .split(/[,\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
      tags: draft.tags
        .split(/[,\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    });
    setDraft(emptyDraft());
    toastMsg(draft.id ? "已更新片段" : "已新增片段");
  };

  return (
    <div className="section">
      <div className="section-title">片段编辑</div>
      <div className="card">
        <div style={{ display: "grid", gap: 8 }}>
          <input
            className="ctrl"
            placeholder="片段名称（如：SSH 到服务器）"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <textarea
            className="ctrl mono"
            rows={3}
            placeholder={"命令模板，参数用 {name} 占位\n如：ssh {user}@{host} -p {port}"}
            value={draft.template}
            onChange={(e) => setDraft({ ...draft, template: e.target.value })}
          />
          {paramNames.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              {paramNames.map((n) => (
                <div key={n} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{ minWidth: 80 }}>{`{${n}}`}</code>
                  <input
                    className="ctrl"
                    placeholder={`${n} 的默认值（可空）`}
                    value={draft.defaults[n] ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        defaults: { ...draft.defaults, [n]: e.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="ctrl"
              style={{ flex: 1 }}
              placeholder="限定 shell（可空，逗号分隔：ps, bash, wsl）"
              value={draft.shellKeys}
              onChange={(e) => setDraft({ ...draft, shellKeys: e.target.value })}
            />
            <input
              className="ctrl"
              style={{ flex: 1 }}
              placeholder="标签（可空，逗号分隔）"
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            />
          </div>
          <div className="btn-row">
            <button className="btn primary" type="button" onClick={saveDraft}>
              {draft.id ? "保存修改" : "新增片段"}
            </button>
            {draft.id && (
              <button
                className="btn"
                type="button"
                onClick={() => setDraft(emptyDraft())}
              >
                取消编辑
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>
        已保存（{list.length}） · 命令面板中以「片段 ·」前缀出现
      </div>
      <div className="card">
        {list.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            暂无片段。常用命令（部署、连接、构建）保存成片段后，
            Ctrl+Shift+P 一键调用，参数会弹窗填写。
          </div>
        )}
        {list.map((sn) => (
          <div
            key={sn.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>{sn.name}</div>
              <code
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {sn.template}
              </code>
            </div>
            {!!sn.shellKeys?.length && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {sn.shellKeys.join("/")}
              </span>
            )}
            <button
              className="btn"
              type="button"
              onClick={() =>
                setDraft({
                  id: sn.id,
                  name: sn.name,
                  template: sn.template,
                  defaults: Object.fromEntries(
                    sn.params.map((p) => [p.name, p.default ?? ""]),
                  ),
                  shellKeys: sn.shellKeys?.join(", ") ?? "",
                  tags: sn.tags?.join(", ") ?? "",
                })
              }
            >
              编辑
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                void askConfirm(`删除片段「${sn.name}」？`, {
                  danger: true,
                  okLabel: "删除",
                }).then((ok) => {
                  if (ok) {
                    deleteSnippet(sn.id);
                    toastMsg("已删除片段");
                  }
                });
              }}
            >
              删除
            </button>
          </div>
        ))}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            className="btn"
            type="button"
            onClick={() => {
              const blob = new Blob([exportSnippetsJson()], {
                type: "application/json",
              });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "aether-snippets.json";
              a.click();
              toastMsg("已导出片段 JSON");
            }}
          >
            导出 JSON
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "application/json,.json";
              input.onchange = () => {
                const file = input.files?.[0];
                if (!file) return;
                void file.text().then((t) => {
                  try {
                    const n = importSnippetsJson(t);
                    toastMsg(`已导入 ${n} 条片段`);
                  } catch (e) {
                    toastMsg(`导入失败: ${e instanceof Error ? e.message : e}`);
                  }
                });
              };
              input.click();
            }}
          >
            导入 JSON…
          </button>
        </div>
      </div>
    </div>
  );
}
