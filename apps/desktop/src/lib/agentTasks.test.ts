import { describe, expect, it, beforeEach } from "vitest";
import {
  TASK_STORE_KEY,
  createTask,
  loadTasks,
  planFromText,
  setActiveTask,
  updateStep,
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

  it("createTask persists", () => {
    const t = createTask("demo", planFromText("#1: pwd\n#2: ls"));
    expect(t.steps.length).toBe(2);
    expect(loadTasks().tasks[0].id).toBe(t.id);
    expect(loadTasks().activeTaskId).toBe(t.id);
  });

  it("updateStep marks done", () => {
    const t = createTask("x", [{ title: "a", command: "pwd" }]);
    const stepId = t.steps[0].id;
    updateStep(t.id, stepId, { status: "done" });
    const again = loadTasks().tasks[0];
    expect(again.steps[0].status).toBe("done");
    expect(again.status).toBe("done");
  });

  it("setActiveTask", () => {
    const a = createTask("a", [{ title: "1" }]);
    const b = createTask("b", [{ title: "2" }]);
    setActiveTask(a.id);
    expect(loadTasks().activeTaskId).toBe(a.id);
    setActiveTask(b.id);
    expect(loadTasks().activeTaskId).toBe(b.id);
  });
});
