import { describe, expect, it } from "vitest";
import {
  detectCwdFromOutput,
  fileUrlToPath,
  parseOsc7Cwd,
  parsePsPromptCwd,
} from "./osc";

describe("osc cwd", () => {
  it("parses OSC 7 file URL windows", () => {
    const p = fileUrlToPath("file:///C:/Users/dev");
    expect(p?.replace(/\//g, "\\").toLowerCase()).toContain("c:\\users\\dev");
  });

  it("parses OSC 7 sequence", () => {
    const chunk = "hello\x1b]7;file:///home/user/proj\x07world";
    expect(parseOsc7Cwd(chunk)).toBe("/home/user/proj");
  });

  it("parses PS prompt cwd", () => {
    expect(parsePsPromptCwd("PS C:\\Users\\dev> ")).toBe("C:\\Users\\dev");
    expect(
      parsePsPromptCwd("old\r\nPS D:\\Document\\aether> echo hi\r\n"),
    ).toBe("D:\\Document\\aether");
  });

  it("detectCwdFromOutput prefers OSC then prompt", () => {
    const cwd = detectCwdFromOutput("\x1b]7;file:///C:/Work\x07PS C:\\Other> ");
    expect(cwd?.toLowerCase()).toContain("work");
  });
});
