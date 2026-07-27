import { useEffect, useState } from "react";
import {
  deleteWorkspace,
  loadWorkspaces,
  type Workspace,
} from "../../lib/workspace";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { askConfirm, askPrompt } from "../../components/AppDialog";

/** Settings UI for named workspaces (V2). */
export function WorkspacePanel() {
  const [list, setList] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const saveWorkspace = useWorkbenchStore((s) => s.saveWorkspace);
  const switchWorkspace = useWorkbenchStore((s) => s.switchWorkspace);
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);

  const reload = () => {
    const store = loadWorkspaces();
    setList(store.workspaces);
    setActiveId(store.activeId);
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="section">
      <div className="section-title">命名工作区</div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
        保存当前标签与分屏布局，便于在项目间切换。也可在命令面板（Ctrl+Shift+P）操作。
      </p>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            void askPrompt("保存工作区", {
              message: "输入工作区名称",
              defaultValue: "我的项目",
            }).then((name) => {
              if (name?.trim()) {
                saveWorkspace(name.trim());
                window.setTimeout(reload, 100);
              }
            });
          }}
        >
          保存当前为工作区
        </button>
      </div>
      <div className="card">
        {list.length === 0 && (
          <div className="row">
            <div className="row-text">
              <div className="row-desc">暂无工作区</div>
            </div>
          </div>
        )}
        {list.map((w) => (
          <div className="row" key={w.id}>
            <div className="row-text">
              <div className="row-label">
                {w.name}
                {w.id === activeId ? " · 当前" : ""}
              </div>
              <div className="row-desc">
                {w.tabs?.length ?? 0} 标签
                {w.defaultCwd ? ` · ${w.defaultCwd}` : ""}
              </div>
            </div>
            <div className="row-control" style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  switchWorkspace(w.id);
                  toastMsg(`已切换 · ${w.name}`);
                  reload();
                }}
              >
                切换
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void askConfirm(`删除工作区「${w.name}」？`, {
                    danger: true,
                    okLabel: "删除",
                  }).then((ok) => {
                    if (ok) {
                      deleteWorkspace(w.id);
                      reload();
                      toastMsg("已删除");
                    }
                  });
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
