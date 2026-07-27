import { describe, expect, it } from "vitest";
import { matchSlashCommands, slashEnterShouldAccept } from "./agentSlash";

describe("agentSlash", () => {
  it("exposes composer commands", () => {
    const all = matchSlashCommands("/");
    expect(all.map((c) => c.cmd).sort()).toEqual(["/focus", "/stop"]);
  });

  it("filters by prefix", () => {
    expect(matchSlashCommands("/f").map((c) => c.cmd)).toEqual(["/focus"]);
    expect(matchSlashCommands("/s").map((c) => c.cmd)).toEqual(["/stop"]);
  });

  it("keeps /focus while typing args", () => {
    const m = matchSlashCommands("/focus 2");
    expect(m).toHaveLength(1);
    expect(m[0].cmd).toBe("/focus");
  });

  it("Enter accepts only while completing token", () => {
    const list = matchSlashCommands("/fo");
    expect(slashEnterShouldAccept("/fo", list)).toBe(true);
    expect(slashEnterShouldAccept("/focus 2", matchSlashCommands("/focus 2"))).toBe(false);
  });
});
