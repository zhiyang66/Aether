import { describe, expect, it, beforeEach } from "vitest";
import {
  TASK_STORE_KEY,
  addSteps,
  createTask,
  formatActiveTaskPrompt,
  formatTaskState,
  getActiveTask,
  getTask,
  loadTasks,
  onTasksChanged,
  planFromText,
  setActiveTask,
  setTaskAutoAdvance,
  updateStep,
  updateTaskStatus,
} from "./agentTasks";

describe("agentTasks", () => {
  beforeEach(() => {
    localStorage.removeItem(TASK_STORE_KEY);
  });

  it("planFromText extracts steps", () => {
    const steps = planFromText(`1. #1: git status
2. run tests in #2
- check logs`);
    expect(steps.length).toBe(3);
    expect(steps[0].targetSerial).toBe(1);
  });

  it("createTask persists with session id, pending steps, autoAdvance", () => {
    const t = createTask("demo", planFromText("#1: pwd\n#2: ls"), "sess-1");
    expect(t.steps.length).toBe(2);
    expect(t.steps[0].status).toBe("pending");
    expect(t.steps[0].attempts).toBe(0);
    expect(t.chatSessionId).toBe("sess-1");
    expect(t.autoAdvance).toBe(true);
    expect(loadTasks().tasks[0].id).toBe(t.id);
    expect(getActiveTask()?.id).toBe(t.id);
  });

  it("task closes only when every step is done/skipped", () => {
    const t = createTask("x", [{ title: "a" }, { title: "b" }]);
    updateStep(t.id, t.steps[0].id, { status: "done" });
    expect(getTask(t.id)?.status).toBe("open");
    updateStep(t.id, t.steps[1].id, { status: "skipped" });
    expect(getTask(t.id)?.status).toBe("done");
  });

  it("records attempts / exitCode / blockId telemetry on steps", () => {
    const t = createTask("x", [{ title: "a", command: "make" }]);
    updateStep(t.id, t.steps[0].id, {
      status: "failed",
      attempts: 2,
      exitCode: 1,
      blockId: "blk-9",
    });
    const s = getTask(t.id)!.steps[0];
    expect(s.attempts).toBe(2);
    expect(s.exitCode).toBe(1);
    expect(s.blockId).toBe("blk-9");
  });

  it("addSteps appends and reopens a finished task (B9)", () => {
    const t = createTask("x", [{ title: "a" }]);
    updateStep(t.id, t.steps[0].id, { status: "done" });
    expect(getTask(t.id)?.status).toBe("done");
    const after = addSteps(t.id, [{ title: "b", command: "ls" }]);
    expect(after?.steps).toHaveLength(2);
    expect(after?.status).toBe("open");
    expect(after?.steps[1].status).toBe("pending");
  });

  it("pause/resume via setTaskAutoAdvance is visible in task state", () => {
    const t = createTask("x", [{ title: "a" }]);
    setTaskAutoAdvance(t.id, false);
    expect(getTask(t.id)?.autoAdvance).toBe(false);
    expect(formatTaskState(getTask(t.id)!)).toContain("已暂停自动推进");
    setTaskAutoAdvance(t.id, true);
    expect(getTask(t.id)?.autoAdvance).toBe(true);
  });

  it("active-task prompt block appears for open tasks only", () => {
    const t = createTask("x", [{ title: "a" }]);
    expect(formatActiveTaskPrompt()).toContain("当前活动任务");
    updateTaskStatus(t.id, "cancelled");
    expect(formatActiveTaskPrompt()).toBe("");
  });

  it("mutations emit change events", () => {
    let n = 0;
    const off = onTasksChanged(() => n++);
    const t = createTask("x", [{ title: "a" }]);
    updateStep(t.id, t.steps[0].id, { status: "running" });
    off();
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("setActiveTask", () => {
    const a = createTask("a", [{ title: "1" }]);
    const b = createTask("b", [{ title: "2" }]);
    setActiveTask(a.id);
    expect(loadTasks().activeTaskId).toBe(a.id);
    setActiveTask(b.id);
    expect(loadTasks().activeTaskId).toBe(b.id);
  });

  it("formatTaskState renders exit/attempt/summary per step", () => {
    const t = createTask("发布", [{ title: "构建", command: "make" }]);
    updateStep(t.id, t.steps[0].id, {
      status: "failed",
      exitCode: 2,
      attempts: 1,
      resultSummary: "编译错误",
    });
    const s = formatTaskState(getTask(t.id)!);
    expect(s).toContain("[✗] 1. 构建");
    expect(s).toContain("exit=2");
    expect(s).toContain("编译错误");
  });
});
