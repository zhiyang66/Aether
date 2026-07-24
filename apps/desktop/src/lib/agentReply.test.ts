import { describe, expect, it } from "vitest";
import { splitAgentReply } from "./agentReply";

describe("splitAgentReply", () => {
  it("strips think tags into thinking", () => {
    const r = splitAgentReply(
      "<think>plan steps</think>\n你好，我是助手。",
    );
    expect(r.thinking).toContain("plan steps");
    expect(r.answer).toContain("你好");
    expect(r.answer).not.toContain("plan steps");
  });

  it("peels English monologue before Chinese answer", () => {
    const r = splitAgentReply(
      `The user said "你好" which means Hello. I am Aether Agent.\nI should respond in Chinese.\n\n你好！我是终端助手。`,
    );
    expect(r.thinking.length).toBeGreaterThan(10);
    expect(r.answer).toMatch(/^你好/);
  });

  it("removes actions JSON from answer", () => {
    const r = splitAgentReply(
      `修好配置。\n\n\`\`\`json\n{"actions":[{"type":"run","command":"x"}]}\n\`\`\``,
    );
    expect(r.answer).toContain("修好");
    expect(r.answer).not.toContain("actions");
  });
});
