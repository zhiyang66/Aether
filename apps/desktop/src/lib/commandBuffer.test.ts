import { describe, expect, it } from "vitest";
import { CommandLineBuffer } from "./commandBuffer";

describe("CommandLineBuffer", () => {
  it("commits on enter", () => {
    const b = new CommandLineBuffer();
    expect(b.push("gi")).toEqual([]);
    expect(b.push("t st")).toEqual([]);
    expect(b.push("atus\r")).toEqual(["git status"]);
  });

  it("handles backspace", () => {
    const b = new CommandLineBuffer();
    b.push("ab");
    b.push("\b");
    expect(b.push("c\r")).toEqual(["ac"]);
  });

  it("clears on ctrl+c", () => {
    const b = new CommandLineBuffer();
    b.push("rm -rf");
    b.push("\x03");
    expect(b.push("ls\r")).toEqual(["ls"]);
  });

  it("strips CSI cursor report before command", () => {
    const b = new CommandLineBuffer();
    // ESC [ 1 ; 1 R then pwd
    expect(b.push("\x1b[1;1Rpwd\r")).toEqual(["pwd"]);
  });

  it("strips focus-in and CPR glued to command", () => {
    const b = new CommandLineBuffer();
    // Simulate debris as seen in history: ESC stripped already in some paths
    // Full with ESC:
    expect(b.push("\x1b[1;1R\x1b[Ipwd\r")).toEqual(["pwd"]);
  });

  it("strips multi-chunk CSI", () => {
    const b = new CommandLineBuffer();
    expect(b.push("\x1b[")).toEqual([]);
    expect(b.push("1;1")).toEqual([]);
    expect(b.push("R")).toEqual([]);
    expect(b.push("echo hi\r")).toEqual(["echo hi"]);
  });
});
