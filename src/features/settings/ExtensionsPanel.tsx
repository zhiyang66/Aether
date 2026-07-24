import { useEffect, useState } from "react";
import {
  type ExtensionManifest,
  ensureExampleExtension,
  importExtensionJson,
  removeExtension,
  setExtensionEnabled,
} from "../../lib/extensions";
import { useWorkbenchStore } from "../../store/workbenchStore";

export function ExtensionsPanel() {
  const [list, setList] = useState<ExtensionManifest[]>([]);
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);

  const reload = () => setList(ensureExampleExtension());

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="section">
      <div className="section-title">本地扩展</div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
        扩展可增加命令面板项与 Agent 系统提示。导入 JSON 清单（需含 id、name）。
      </p>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json,.json";
            input.onchange = () => {
              const file = input.files?.[0];
              if (!file) return;
              void file.text().then((t) => {
                try {
                  const ext = importExtensionJson(t);
                  toastMsg(`已导入扩展 · ${ext.name}`);
                  reload();
                } catch (e) {
                  toastMsg(`导入失败：${e instanceof Error ? e.message : e}`);
                }
              });
            };
            input.click();
          }}
        >
          导入扩展 JSON
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            ensureExampleExtension();
            reload();
            toastMsg("已确保官方示例扩展存在");
          }}
        >
          恢复官方示例
        </button>
      </div>
      <div className="card">
        {list.map((e) => (
          <div className="row" key={e.id}>
            <div className="row-text">
              <div className="row-label">
                {e.name}{" "}
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                  v{e.version}
                </span>
              </div>
              <div className="row-desc">
                {e.description || e.id}
                {e.commands?.length ? ` · ${e.commands.length} 条命令` : ""}
              </div>
            </div>
            <div className="row-control" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={e.enabled !== false}
                  onChange={(ev) => {
                    setExtensionEnabled(e.id, ev.target.checked);
                    reload();
                  }}
                />
                <span className="switch-track" />
              </label>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (confirm(`移除扩展「${e.name}」？`)) {
                    removeExtension(e.id);
                    reload();
                  }
                }}
              >
                移除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
