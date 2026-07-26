import { describe, expect, it } from "vitest";
import { isDangerousCommand, resolveDangerAction } from "./danger";

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

describe("resolveDangerAction (shared exec policy)", () => {
  const confirm = { execMode: "confirm" as const, confirmDanger: true };
  const auto = { execMode: "auto" as const, confirmDanger: true };
  const insert = { execMode: "insert" as const, confirmDanger: true };

  it("wantRun=false never runs, silently", () => {
    expect(resolveDangerAction("rm -rf /", auto, false)).toMatchObject({
      run: false,
      note: "",
    });
  });

  it("insert mode never runs", () => {
    expect(resolveDangerAction("ls", insert, true)).toMatchObject({
      run: false,
      note: "insert-only",
    });
  });

  it("confirm + dangerous → insert-only with danger note", () => {
    expect(resolveDangerAction("rm -rf /", confirm, true)).toMatchObject({
      run: false,
      dangerous: true,
      note: "danger-insert",
    });
  });

  it("confirm + safe → runs silently", () => {
    expect(resolveDangerAction("git status", confirm, true)).toMatchObject({
      run: true,
      note: "",
    });
  });

  it("auto + dangerous → runs with warning note", () => {
    expect(resolveDangerAction("rm -rf /", auto, true)).toMatchObject({
      run: true,
      dangerous: true,
      note: "danger-auto-run",
    });
  });

  it("confirmDanger=false disables the danger downgrade", () => {
    expect(
      resolveDangerAction("rm -rf /", { execMode: "confirm", confirmDanger: false }, true),
    ).toMatchObject({ run: true, note: "" });
  });
});
