import { describe, expect, it } from "vitest";
import { parseAgentActions } from "./agentActions";

describe("parseAgentActions", () => {
  it("parses JSON actions fence", () => {
    const text = `ok
\`\`\`json
{"actions":[
  {"type":"run","targetSerial":2,"command":"pwd","label":"看路径"},
  {"type":"insert","target_serial":1,"command":"ls"}
]}
\`\`\``;
    const a = parseAgentActions(text);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ type: "run", targetSerial: 2, command: "pwd" });
    expect(a[1]).toMatchObject({ type: "insert", targetSerial: 1, command: "ls" });
  });

  it("parses explicit markdown list with type + #N", () => {
    const text = `- run #2: git status
- insert #1: Get-Location`;
    const a = parseAgentActions(text);
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(a[0].targetSerial).toBe(2);
    expect(a[0].command).toContain("git status");
  });

  it("does not invent actions from bare code fence", () => {
    const a = parseAgentActions("在 #3 执行\n```bash\necho hi\n```");
    expect(a).toHaveLength(0);
  });

  it("parses focus action", () => {
    const a = parseAgentActions(`\`\`\`json
{"actions":[{"type":"focus","targetSerial":2,"label":"去 #2"}]}
\`\`\``);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: "focus", targetSerial: 2 });
  });

  it("does not hardcode-infer 1/2 menus without model JSON", () => {
    const text = `
Codex 已启动。
- 1 Yes, continue（信任并继续）
- 2 No, quit（退出）
请在终端按 1 或 2。
`;
    // Client must NOT invent chips — model should emit actions via skill
    expect(parseAgentActions(text)).toHaveLength(0);
  });

  it("accepts flexible interactive keys from model JSON", () => {
    const a = parseAgentActions(`说明选项。
\`\`\`json
{"actions":[
  {"type":"run","command":"1","label":"信任并继续","targetSerial":1},
  {"type":"run","command":"2","label":"退出","targetSerial":1}
]}
\`\`\``);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ command: "1", label: "信任并继续" });
    expect(a[1]).toMatchObject({ command: "2", label: "退出" });
  });

  it("parses reply actions for multi-pane ask", () => {
    const a = parseAgentActions(`有多个窗格，请选择：
\`\`\`json
{"actions":[
  {"type":"reply","text":"在 WSL（T2:#1）执行","label":"WSL T2"},
  {"type":"reply","text":"在 PS（T1:#1）执行","label":"PS T1"}
]}
\`\`\``);
    expect(a).toHaveLength(2);
    expect(a[0].type).toBe("reply");
    expect(a[0].text).toContain("WSL");
  });

  it("finds actions in the last of multiple fences", () => {
    const a = parseAgentActions(`先看这段
\`\`\`bash
echo hi
\`\`\`
再选窗格
\`\`\`json
{"actions":[{"type":"reply","text":"用 T2","label":"T2"}]}
\`\`\``);
    expect(a).toHaveLength(1);
    expect(a[0].label).toBe("T2");
  });
});
