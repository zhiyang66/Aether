import { describe, expect, it } from "vitest";
import { matchSlashCommands, slashEnterShouldAccept } from "./agentSlash";

describe("agentSlash", () => {
  it("exposes composer commands", () => {
    const all = matchSlashCommands("/");
    expect(all.map((c) => c.cmd).sort()).toEqual(["/focus", "/stop", "/task"]);
  });

  it("filters by prefix", () => {
    expect(matchSlashCommands("/t").map((c) => c.cmd)).toEqual(["/task"]);
  });

  it("keeps /task while typing title", () => {
    const m = matchSlashCommands("/task 修 profile");
    expect(m).toHaveLength(1);
    expect(m[0].cmd).toBe("/task");
  });

  it("Enter accepts only while completing token", () => {
    const list = matchSlashCommands("/fo");
    expect(slashEnterShouldAccept("/fo", list)).toBe(true);
    expect(slashEnterShouldAccept("/focus 2", matchSlashCommands("/focus 2"))).toBe(false);
  });
});
