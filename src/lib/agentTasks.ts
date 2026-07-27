/**
 * Agent task mode — 0.9 autonomy rework.
 *
 * Tasks are a plan-execute loop shared by the user (TaskPanel) and the Agent
 * (task_* tools in agentToolLoop). Storage is localStorage; every mutation
 * emits a change event so panel and status UI stay live.
 */

export const TASK_STORE_KEY = "sw-agent-tasks-v1";

export type AgentTaskStep = {
  id: string;
  title: string;
  command?: string;
  targetSerial?: number;
  status: "pending" | "running" | "done" | "skipped" | "failed";
  resultSummary?: string;
  /** 0.9: execution telemetry */
  attempts?: number;
  exitCode?: number | null;
  /** command block id (0.8) of the last run — for jump-to-block */
  blockId?: string;
  /** pane the last run happened in */
  paneId?: string;
};

export type AgentTask = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "open" | "done" | "cancelled";
  steps: AgentTaskStep[];
  chatSessionId?: string;
  /** false = 暂停自动推进（Agent 应停止执行后续步骤，仅建议） */
  autoAdvance?: boolean;
};

export type TaskStore = {
  version: 1;
  tasks: AgentTask[];
  activeTaskId: string | null;
};

type TaskListener = () => void;
const listeners = new Set<TaskListener>();

export function onTasksChanged(l: TaskListener): () => void {
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

export function loadTasks(): TaskStore {
  try {
    const raw = localStorage.getItem(TASK_STORE_KEY);
    if (!raw) return { version: 1, tasks: [], activeTaskId: null };
    const data = JSON.parse(raw) as TaskStore;
    return {
      version: 1,
      tasks: data.tasks || [],
      activeTaskId: data.activeTaskId ?? null,
    };
  } catch {
    return { version: 1, tasks: [], activeTaskId: null };
  }
}

export function saveTasks(store: TaskStore) {
  store.tasks = store.tasks.slice(0, 50);
  localStorage.setItem(TASK_STORE_KEY, JSON.stringify(store));
  emit();
}

let stepSeq = 0;

function makeStep(s: Omit<AgentTaskStep, "id" | "status">): AgentTaskStep {
  return {
    ...s,
    id: `step-${Date.now()}-${++stepSeq}`,
    status: "pending",
    attempts: 0,
  };
}

export function createTask(
  title: string,
  steps: Omit<AgentTaskStep, "id" | "status">[],
  chatSessionId?: string,
): AgentTask {
  const now = new Date().toISOString();
  const task: AgentTask = {
    id: `task-${Date.now()}`,
    title,
    createdAt: now,
    updatedAt: now,
    status: "open",
    steps: steps.map(makeStep),
    chatSessionId,
    autoAdvance: true,
  };
  const store = loadTasks();
  store.tasks.unshift(task);
  store.activeTaskId = task.id;
  saveTasks(store);
  return task;
}

export function getTask(id: string): AgentTask | null {
  return loadTasks().tasks.find((t) => t.id === id) ?? null;
}

export function getActiveTask(): AgentTask | null {
  const store = loadTasks();
  if (!store.activeTaskId) return null;
  return store.tasks.find((t) => t.id === store.activeTaskId) ?? null;
}

export function setActiveTask(id: string | null) {
  const store = loadTasks();
  store.activeTaskId = id;
  saveTasks(store);
}

export function updateStep(
  taskId: string,
  stepId: string,
  patch: Partial<AgentTaskStep>,
): AgentTask | null {
  const store = loadTasks();
  const task = store.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  task.steps = task.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s));
  task.updatedAt = new Date().toISOString();
  if (task.steps.every((s) => s.status === "done" || s.status === "skipped")) {
    task.status = "done";
  }
  saveTasks(store);
  return task;
}

/** 0.9: append steps to an existing task (B9 — 自然语言补充步骤). */
export function addSteps(
  taskId: string,
  steps: Omit<AgentTaskStep, "id" | "status">[],
): AgentTask | null {
  const store = loadTasks();
  const task = store.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  task.steps = [...task.steps, ...steps.map(makeStep)];
  // Adding steps to a finished task reopens it
  if (task.status === "done") task.status = "open";
  task.updatedAt = new Date().toISOString();
  saveTasks(store);
  return task;
}

export function updateTaskStatus(
  taskId: string,
  status: AgentTask["status"],
): AgentTask | null {
  const store = loadTasks();
  const task = store.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  task.status = status;
  task.updatedAt = new Date().toISOString();
  saveTasks(store);
  return task;
}

export function setTaskAutoAdvance(taskId: string, on: boolean): AgentTask | null {
  const store = loadTasks();
  const task = store.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  task.autoAdvance = on;
  task.updatedAt = new Date().toISOString();
  saveTasks(store);
  return task;
}

export function deleteTask(taskId: string) {
  const store = loadTasks();
  store.tasks = store.tasks.filter((t) => t.id !== taskId);
  if (store.activeTaskId === taskId) {
    store.activeTaskId = store.tasks[0]?.id ?? null;
  }
  saveTasks(store);
}

export function planFromText(text: string): Omit<AgentTaskStep, "id" | "status">[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter(Boolean);
  return lines.slice(0, 12).map((title) => {
    const serial = title.match(/#(\d+)/);
    const cmd = title.match(/`([^`]+)`/) || title.match(/:\s*(.+)$/);
    return {
      title,
      targetSerial: serial ? Number(serial[1]) : undefined,
      command: cmd ? cmd[1].trim() : undefined,
    };
  });
}

const STEP_ICON: Record<AgentTaskStep["status"], string> = {
  pending: "[ ]",
  running: "[…]",
  done: "[✓]",
  skipped: "[→]",
  failed: "[✗]",
};

/** One-line-per-step task state for tool results / system prompt. */
export function formatTaskState(task: AgentTask): string {
  const head = `任务「${task.title}」 id=${task.id} 状态=${task.status}${
    task.autoAdvance === false ? "（已暂停自动推进：不要继续执行步骤，等用户恢复）" : ""
  }`;
  const steps = task.steps.map((s, i) => {
    const bits = [
      `${STEP_ICON[s.status]} ${i + 1}. ${s.title}`,
      s.command ? `cmd: ${s.command}` : "",
      s.exitCode != null ? `exit=${s.exitCode}` : "",
      s.attempts ? `尝试${s.attempts}次` : "",
      s.resultSummary ? `结论: ${s.resultSummary}` : "",
    ].filter(Boolean);
    return "  " + bits.join(" · ");
  });
  return [head, ...steps].join("\n");
}

/**
 * System-prompt block for the active task (empty string when none).
 * Injected each round so the model always sees current task state.
 */
export function formatActiveTaskPrompt(): string {
  const task = getActiveTask();
  if (!task || task.status !== "open") return "";
  return [
    "## 当前活动任务",
    formatTaskState(task),
    "推进方式：run_command(wait_for_exit=true) 执行步骤命令 → 依据退出码 task_update_step 标记 done/failed（附 result_summary）→ 继续下一步。失败可重试（≤2 次），仍失败则标 failed 并向用户说明。可用 task_add_steps 补充步骤。",
  ].join("\n");
}
