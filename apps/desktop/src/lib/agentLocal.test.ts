import { describe, expect, it } from "vitest";
import { parseTargetSerial } from "./agentLocal";
import { extractCommandMeta } from "./sanitize";
import { fileUrlToPath, parseOsc7Cwd, stripAnsi } from "./osc";

describe("parseTargetSerial", () => {
  it("parses #N and 窗格 N", () => {
    expect(parseTargetSerial("在 #2 执行 pwd")).toBe(2);
    expect(parseTargetSerial("窗格 3 的输出")).toBe(3);
    expect(parseTargetSerial("pane 1 please")).toBe(1);
    expect(parseTargetSerial("T2:#1 的输出")).toBe(1);
  });

  it("returns undefined without serial", () => {
    expect(parseTargetSerial("hello world")).toBeUndefined();
  });
});

describe("extractCommandMeta", () => {
  it("extracts fence and serial", () => {
    const t = "请在 #2 运行：\n```bash\npwd\nls\n```";
    const m = extractCommandMeta(t);
    expect(m.targetSerial).toBe(2);
    expect(m.cmd).toBe("pwd\nls");
  });
});

describe("osc cwd", () => {
  it("parses file URL windows", () => {
    expect(fileUrlToPath("file:///C:/Users/dev")).toMatch(/C:\\Users\\dev/i);
  });

  it("parses OSC 7 sequence", () => {
    const chunk = "hello\x1b]7;file:///home/user/proj\x07world";
    expect(parseOsc7Cwd(chunk)).toBe("/home/user/proj");
  });

  it("stripAnsi removes CSI", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });
});
