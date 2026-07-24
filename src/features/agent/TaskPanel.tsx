import { useCallback, useEffect, useState } from "react";
import {
  type AgentTask,
  deleteTask,
  loadTasks,
  setActiveTask,
  updateStep,
  updateTaskStatus,
} from "../../lib/agentTasks";
import { findLeaf } from "../../lib/layout";
import { useWorkbenchStore } from "../../store/workbenchStore";

/** Prefer suggested serial if still open; always insert into current focus afterwards. */
function focusSuggestedSerial(serial: number | undefined): void {
  if (serial == null) return;
  const st = useWorkbenchStore.getState();
  const leaf = st.resolveSerial(serial);
  if (!leaf) {
    st.toastMsg(`建议 #${serial} 已关闭 · 将使用当前焦点窗格`);
    return;
  }
  for (const t of st.tabs) {
    if (findLeaf(t.layout, leaf.id)) {
      st.setActiveTab(t.id);
      break;
    }
  }
  st.setActivePane(leaf.id);
}

/** Multi-step Agent task runner UI (V2 major). */
export function TaskPanel({
  open,
  onClose,
  refreshKey = 0,
}: {
  open: boolean;
  onClose: () => void;
  refreshKey?: number;
}) {
  const insertToPane = useWorkbenchStore((s) => s.insertToPane);
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const reload = useCallback(() => {
    const store = loadTasks();
    setTasks(store.tasks);
    setActiveId(store.activeTaskId);
  }, []);

  useEffect(() => {
    if (open) reload();
  }, [open, refreshKey, reload]);

  if (!open) return null;

  const active = tasks.find((t) => t.id === activeId) || tasks[0] || null;

  return (
    <div className="task-panel">
      <div className="task-panel-head">
        <strong>任务</strong>
        <button type="button" className="pane-close" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="task-panel-body">
        <div className="task-list">
          {tasks.length === 0 && (
            <div className="task-empty">
              暂无任务。在对话中输入：
              <code>/task 标题</code> 换行后写步骤（可用 <code>#2: cmd</code>）
            </div>
          )}
          {tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`task-list-item${t.id === active?.id ? " active" : ""}`}
              onClick={() => {
                setActiveTask(t.id);
                setActiveId(t.id);
              }}
            >
              <span className="task-list-title">{t.title}</span>
              <span className={`task-status st-${t.status}`}>{statusLabel(t.status)}</span>
            </button>
          ))}
        </div>
        {active && (
          <div className="task-detail">
            <div className="task-detail-head">
              <div>
                <div className="task-detail-title">{active.title}</div>
                <div className="task-detail-meta">
                  {active.steps.filter((s) => s.status === "done").length}/{active.steps.length} 完成
                </div>
              </div>
              <div className="task-detail-actions">
                {active.status === "open" && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      updateTaskStatus(active.id, "cancelled");
                      toastMsg("任务已取消");
                      reload();
                    }}
                  >
                    取消任务
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (confirm("删除此任务？")) {
                      deleteTask(active.id);
                      toastMsg("任务已删除");
                      reload();
                    }
                  }}
                >
                  删除
                </button>
              </div>
            </div>
            <ol className="task-steps">
              {active.steps.map((step, i) => (
                <li key={step.id} className={`task-step st-${step.status}`}>
                  <div className="task-step-main">
                    <span className="task-step-idx">{i + 1}</span>
                    <div className="task-step-text">
                      <div>{step.title}</div>
                      {step.command && (
                        <code className="task-step-cmd">
                          {step.targetSerial != null ? `#${step.targetSerial} ` : ""}
                          {step.command}
                        </code>
                      )}
                    </div>
                    <span className={`task-status st-${step.status}`}>
                      {stepStatusLabel(step.status)}
                    </span>
                  </div>
                  <div className="task-step-btns">
                    {step.command && step.status !== "done" && (
                      <>
                        <button
                          type="button"
                          className="chip-btn"
                          title="插入到当前选中窗格"
                          onClick={() => {
                            focusSuggestedSerial(step.targetSerial);
                            insertToPane(undefined, step.command!, false);
                            updateStep(active.id, step.id, { status: "pending" });
                            reload();
                          }}
                        >
                          仅插入
                        </button>
                        <button
                          type="button"
                          className="chip-btn"
                          title="在当前选中窗格执行"
                          onClick={() => {
                            focusSuggestedSerial(step.targetSerial);
                            updateStep(active.id, step.id, { status: "running" });
                            insertToPane(undefined, step.command!, true);
                            updateStep(active.id, step.id, {
                              status: "done",
                              resultSummary: "已发送执行",
                            });
                            const focus = useWorkbenchStore.getState().activePane();
                            toastMsg(
                              `步骤 ${i + 1} 已在当前窗格 #${focus?.serial ?? "?"} 执行`,
                            );
                            reload();
                          }}
                        >
                          执行
                        </button>
                      </>
                    )}
                    {step.status === "pending" && (
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => {
                          updateStep(active.id, step.id, { status: "skipped" });
                          reload();
                        }}
                      >
                        跳过
                      </button>
                    )}
                    {(step.status === "done" || step.status === "failed") && (
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => {
                          updateStep(active.id, step.id, {
                            status: "pending",
                            resultSummary: undefined,
                          });
                          reload();
                          toastMsg("已重置为待做 · 可重试");
                        }}
                      >
                        重试
                      </button>
                    )}
                    {step.command && step.status !== "failed" && step.status !== "pending" && (
                      <button
                        type="button"
                        className="chip-btn"
                        title="标记失败以便重试"
                        onClick={() => {
                          updateStep(active.id, step.id, {
                            status: "failed",
                            resultSummary: "手动标记失败",
                          });
                          reload();
                        }}
                      >
                        标失败
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {active.status === "open" &&
              active.steps.filter((s) => s.status === "failed" && s.command).length > 0 && (
                <button
                  type="button"
                  className="btn task-run-next"
                  onClick={() => {
                    const failed = active.steps.filter(
                      (s) => s.status === "failed" && s.command,
                    );
                    for (const s of failed) {
                      updateStep(active.id, s.id, { status: "pending" });
                    }
                    toastMsg(`已重置 ${failed.length} 个失败步骤`);
                    reload();
                  }}
                >
                  重置全部失败步骤
                </button>
              )}
            {active.status === "open" &&
              active.steps.some((s) => s.status === "pending" && s.command) && (
                <button
                  type="button"
                  className="btn primary task-run-next"
                  onClick={() => {
                    const next = active.steps.find(
                      (s) => s.status === "pending" && s.command,
                    );
                    if (!next?.command) return;
                    updateStep(active.id, next.id, { status: "running" });
                    insertToPane(next.targetSerial, next.command, true);
                    updateStep(active.id, next.id, {
                      status: "done",
                      resultSummary: "已发送执行",
                    });
                    toastMsg("已执行下一步");
                    reload();
                  }}
                >
                  执行下一步
                </button>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

function statusLabel(s: AgentTask["status"]) {
  if (s === "open") return "进行中";
  if (s === "done") return "完成";
  return "已取消";
}

function stepStatusLabel(s: AgentTask["steps"][0]["status"]) {
  const map = {
    pending: "待做",
    running: "执行中",
    done: "完成",
    skipped: "跳过",
    failed: "失败",
  };
  return map[s];
}
