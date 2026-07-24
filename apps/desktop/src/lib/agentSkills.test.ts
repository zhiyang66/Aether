import { describe, expect, it } from "vitest";
import { BUILTIN_SKILLS, formatAgentSkillsPrompt } from "./agentSkills";

describe("agentSkills", () => {
  it("includes actions skill with flexible guidance", () => {
    const p = formatAgentSkillsPrompt();
    expect(p).toContain("UI Actions");
    expect(p).toContain("actions");
    expect(p).toMatch(/label/);
    expect(p).toMatch(/灵活|勿套固定/);
  });

  it("has tools + workbench + interactive skills", () => {
    const ids = BUILTIN_SKILLS.map((s) => s.id);
    expect(ids).toContain("tools");
    expect(ids).toContain("workbench");
    expect(ids).toContain("actions");
    expect(ids).toContain("interactive-cli");
    const p = formatAgentSkillsPrompt();
    expect(p).toMatch(/split_pane/);
    expect(p).toMatch(/new_tab/);
  });
});
