import { describe, expect, it } from "vitest";
import { isDangerousCommand } from "./danger";

describe("isDangerousCommand", () => {
  it("flags rm -rf", () => {
    expect(isDangerousCommand("rm -rf /")).toBe(true);
    expect(isDangerousCommand("rm -fr ./tmp")).toBe(true);
  });

  it("flags force push and iex", () => {
    expect(isDangerousCommand("git push --force origin main")).toBe(true);
    expect(isDangerousCommand("iex (download)")).toBe(true);
  });

  it("allows safe commands", () => {
    expect(isDangerousCommand("ls -la")).toBe(false);
    expect(isDangerousCommand("git status")).toBe(false);
    expect(isDangerousCommand("Get-ChildItem")).toBe(false);
  });
});
