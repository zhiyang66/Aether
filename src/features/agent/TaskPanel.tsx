import { useCallback, useEffect, useState } from "react";
import {
  type AgentTask,
  type AgentTaskStep,
  deleteTask,
  loadTasks,
  onTasksChanged,
  setActiveTask,
  setTaskAutoAdvance,
  updateStep,
  updateTaskStatus,
} from "../../lib/agentTasks";
import {
  formatDuration,
  getBlocks,
  lastBlock,
  onBlocksChanged,
} from "../../lib/commandBlocks";
import { sendNotify } from "../../lib/notify";
import { findLeaf } from "../../lib/layout";
import { getLiveTerm } from "../terminal/termRegistry";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { askConfirm } from "../../components/AppDialog";

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

const STEP_TIMEOUT_MS = 120_000;

/**
 * 0.9: run a step for real — mark running, execute in the focused pane, then
 * let the OSC 133 block completion decide done/failed with the true exit code.
 * Degrades to "sent, exit unknown" when the pane has no shell integration.
 */
function runStepLive(task: AgentTask, step: AgentTaskStep) {
  const st = useWorkbenchStore.getState();
  if (!step.command) return;
  focusSuggestedSerial(step.targetSerial);
  const pane = useWorkbenchStore.getState().activePane();
  updateStep(task.id, step.id, {
    status: "running",
    attempts: (step.attempts ?? 0) + 1,
    exitCode: undefined,
    blockId: undefined,
    paneId: pane?.id,
    resultSummary: undefined,
  });
  st.insertToPane(undefined, step.command, true);
  if (!pane) return;

  const paneId = pane.id;
  const t0 = Date.now();
  let settled = false;
  const finish = (patch: Partial<AgentTaskStep>) => {
    if (settled) return;
    settled = true;
    off();
    window.clearTimeout(degradeTimer);
    window.clearTimeout(timeoutTimer);
    updateStep(task.id, step.id, patch);
  };

  const off = onBlocksChanged((pid) => {
    if (pid !== paneId || settled) return;
    const b = lastBlock(paneId);
    if (!b || b.startedAt < t0 - 1500 || b.running) return;
    const ok = (b.exitCode ?? 0) === 0;
    const dur = formatDuration((b.endedAt ?? Date.now()) - b.startedAt);
    finish({
      status: ok ? "done" : "failed",
      exitCode: b.exitCode,
      blockId: b.id,
      paneId,
      resultSummary: ok ? `exit 0 · ${dur}` : `exit ${b.exitCode} · ${dur}`,
    });
    if (!ok) {
      void sendNotify("任务步骤失败", `${step.title} — exit ${b.exitCode}`);
    } else if (document.hidden || !document.hasFocus()) {
      void sendNotify("任务步骤完成", `${step.title} · ${dur}`);
    }
  });

  // No C-mark within 4s → pane has no integration; snapshot semantics
  const degradeTimer = window.setTimeout(() => {
    if (settled) return;
    const b = lastBlock(paneId);
    if (b && b.startedAt >= t0 - 1500) return; // block did arrive, keep waiting
    finish({
      status: "done",
      exitCode: null,
      resultSummary: "已发送执行（该窗格无命令块，退出码未知）",
    });
  }, 4000);

  const timeoutTimer = window.setTimeout(() => {
    finish({
      status: "failed",
      exitCode: null,
      resultSummary: `超时 ${STEP_TIMEOUT_MS / 1000}s 未结束（命令可能仍在运行）`,
    });
  }, STEP_TIMEOUT_MS);
}

function jumpToStepBlock(step: AgentTaskStep): boolean {
  if (!step.paneId || !step.blockId) return false;
  const block = getBlocks(step.paneId).find((b) => b.id === step.blockId);
  const live = getLiveTerm(step.paneId);
  if (!block || !live || !block.marker || block.marker.isDisposed) return false;
  const st = useWorkbenchStore.getState();
  for (const t of st.tabs) {
    if (findLeaf(t.layout, step.paneId)) {
      st.setActiveTab(t.id);
      break;
    }
  }
  st.setActivePane(step.paneId);
  live.term.scrollToLine(block.marker.line);
  return true;
}

/** Multi-step Agent task runner UI (0.9 autonomy rework). */
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
  const chatSessionId = useWorkbenchStore((s) => s.activeAgentSessionId);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const reload = useCallback(() => {
    const store = loadTasks();
    setTasks(store.tasks);
    setActiveId(store.activeTaskId);
  }, []);

  useEffect(() => {
    if (open) reload();
  }, [open, refreshKey, reload]);

  // Live: agent task tools / block completions mutate the store outside React
  useEffect(() => {
    if (!open) return;
    return onTasksChanged(reload);
  }, [open, reload]);

  if (!open) return null;

  // D6: filter to current chat session (sessionless tasks always shown)
  const visible = showAll
    ? tasks
    : tasks.filter((t) => !t.chatSessionId || t.chatSessionId === chatSessionId);

  const active = visible.find((t) => t.id === activeId) || visible[0] || null;

  return (
    <div className="task-panel">
      <div className="task-panel-head">
        <strong>任务</strong>
        <label
          style={{
            marginLeft: "auto",
            marginRight: 8,
            fontSize: 11,
            color: "var(--muted)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          全部会话
        </label>
        <button type="button" className="pane-close" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="task-panel-body">
        <div className="task-list">
          {visible.length === 0 && (
            <div className="task-empty">
              暂无任务。对 Agent 说「帮我完成…」让它用 task_create 规划，或输入：
              <code>/task 标题</code> 换行后写步骤（可用 <code>#2: cmd</code>）
            </div>
          )}
          {visible.map((t) => (
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
                  {active.autoAdvance === false ? " · 已暂停自动推进" : ""}
                </div>
              </div>
              <div className="task-detail-actions">
                {active.status === "open" && (
                  <button
                    type="button"
                    className="btn"
                    title="暂停后 Agent 不再自动执行后续步骤"
                    onClick={() => {
                      const next = active.autoAdvance === false;
                      setTaskAutoAdvance(active.id, next);
                      toastMsg(next ? "已恢复自动推进" : "已暂停自动推进");
                    }}
                  >
                    {active.autoAdvance === false ? "恢复推进" : "暂停推进"}
                  </button>
                )}
                {active.status === "open" && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      updateTaskStatus(active.id, "cancelled");
                      toastMsg("任务已取消");
                    }}
                  >
                    取消任务
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void askConfirm("删除此任务？", {
                      danger: true,
                      okLabel: "删除",
                    }).then((ok) => {
                      if (ok) {
                        deleteTask(active.id);
                        toastMsg("任务已删除");
                      }
                    });
                  }}
                >
                  删除
                </button>
              </div>
            </div>
            <ol className="task-steps">
              {active.steps.map((step, i) => (
                <li key={step.id} className={`task-step st-${step.status}`}>
                  <div
                    className="task-step-main"
                    role={step.blockId ? "button" : undefined}
                    tabIndex={step.blockId ? 0 : undefined}
                    style={step.blockId ? { cursor: "pointer" } : undefined}
                    title={step.blockId ? "点击跳转到对应命令块" : undefined}
                    onClick={() => {
                      if (step.blockId && !jumpToStepBlock(step)) {
                        toastMsg("命令块已不在缓冲区");
                      }
                    }}
                  >
                    <span className="task-step-idx">{i + 1}</span>
                    <div className="task-step-text">
                      <div>{step.title}</div>
                      {step.command && (
                        <code className="task-step-cmd">
                          {step.targetSerial != null ? `#${step.targetSerial} ` : ""}
                          {step.command}
                        </code>
                      )}
                      {(step.resultSummary || (step.attempts ?? 0) > 1) && (
                        <div
                          style={{
                            fontSize: 11,
                            color:
                              step.status === "failed"
                                ? "oklch(0.72 0.15 25)"
                                : "var(--muted)",
                          }}
                        >
                          {step.resultSummary}
                          {(step.attempts ?? 0) > 1 ? ` · 第 ${step.attempts} 次尝试` : ""}
                        </div>
                      )}
                    </div>
                    <span className={`task-status st-${step.status}`}>
                      {stepStatusLabel(step.status)}
                    </span>
                  </div>
                  <div className="task-step-btns">
                    {step.command && step.status !== "done" && step.status !== "running" && (
                      <>
                        <button
                          type="button"
                          className="chip-btn"
                          title="插入到当前选中窗格"
                          onClick={() => {
                            focusSuggestedSerial(step.targetSerial);
                            insertToPane(undefined, step.command!, false);
                          }}
                        >
                          仅插入
                        </button>
                        <button
                          type="button"
                          className="chip-btn"
                          title="在当前选中窗格执行（按退出码判定成败）"
                          onClick={() => runStepLive(active, step)}
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
                            exitCode: undefined,
                          });
                          toastMsg("已重置为待做 · 可重试");
                        }}
                      >
                        重试
                      </button>
                    )}
                    {step.status === "running" && (
                      <button
                        type="button"
                        className="chip-btn"
                        title="不再等待退出码"
                        onClick={() => {
                          updateStep(active.id, step.id, {
                            status: "failed",
                            resultSummary: "手动中止等待",
                          });
                        }}
                      >
                        中止等待
                      </button>
                    )}
                    {step.command &&
                      step.status !== "failed" &&
                      step.status !== "pending" &&
                      step.status !== "running" && (
                        <button
                          type="button"
                          className="chip-btn"
                          title="标记失败以便重试"
                          onClick={() => {
                            updateStep(active.id, step.id, {
                              status: "failed",
                              resultSummary: "手动标记失败",
                            });
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
                    runStepLive(active, next);
                    toastMsg("已执行下一步 · 等待退出码");
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
