/**
 * Agent task mode (multi-step) — V2.0 major.
 */

export const TASK_STORE_KEY = "sw-agent-tasks-v1";

export type AgentTaskStep = {
  id: string;
  title: string;
  command?: string;
  targetSerial?: number;
  status: "pending" | "running" | "done" | "skipped" | "failed";
  resultSummary?: string;
};

export type AgentTask = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "open" | "done" | "cancelled";
  steps: AgentTaskStep[];
  chatSessionId?: string;
};

export type TaskStore = {
  version: 1;
  tasks: AgentTask[];
  activeTaskId: string | null;
};

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
}

export function createTask(
  title: string,
  steps: Omit<AgentTaskStep, "id" | "status">[],
): AgentTask {
  const now = new Date().toISOString();
  const task: AgentTask = {
    id: `task-${Date.now()}`,
    title,
    createdAt: now,
    updatedAt: now,
    status: "open",
    steps: steps.map((s, i) => ({
      ...s,
      id: `step-${i}-${Date.now()}`,
      status: "pending" as const,
    })),
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
