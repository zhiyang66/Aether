import { describe, expect, it } from "vitest";
import {
  BUILTIN_SKILLS,
  composeSkillFile,
  formatAgentSkillsPrompt,
  parseSkillFile,
} from "./agentSkills";

describe("agentSkills", () => {
  it("loads the built-in skills from bundled SKILL.md files", () => {
    // Parsed from the repo skills/*/SKILL.md via Vite glob — not TS constants.
    expect(BUILTIN_SKILLS.length).toBe(9);
    for (const s of BUILTIN_SKILLS) {
      expect(s.id).toBeTruthy();
      expect(s.body.length).toBeGreaterThan(0);
    }
  });

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

  it("includes the capability + creator skills, advertised to the model", () => {
    const ids = BUILTIN_SKILLS.map((s) => s.id);
    for (const id of ["app-control", "mcp-setup", "ssh-hosts", "utilities", "skill-creator"]) {
      expect(ids).toContain(id);
    }
    // skill-creator now teaches authoring on-disk SKILL.md files under ~/.aether
    const creator = BUILTIN_SKILLS.find((s) => s.id === "skill-creator");
    expect(creator?.body).toMatch(/\.aether\/skills|SKILL\.md/);
    // capability tools are advertised in the prompt
    const p = formatAgentSkillsPrompt();
    for (const tool of ["app_query", "mcp_manage", "hosts_manage", "snippet_manage", "recording", "broadcast"]) {
      expect(p).toContain(tool);
    }
  });

  it("every skill has a unique id and a display summary", () => {
    const ids = BUILTIN_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of BUILTIN_SKILLS) {
      expect(typeof s.summary).toBe("string");
      expect(s.summary!.length).toBeGreaterThan(0);
    }
  });
});

describe("parseSkillFile", () => {
  it("parses frontmatter and body", () => {
    const text = `---
name: demo
title: 演示
category: 测试
description: 一句话
---

正文第一行
正文第二行
`;
    const s = parseSkillFile(text, "fallback");
    expect(s.id).toBe("demo");
    expect(s.title).toBe("演示");
    expect(s.category).toBe("测试");
    expect(s.summary).toBe("一句话");
    expect(s.body.startsWith("正文第一行")).toBe(true);
    expect(s.body).toContain("正文第二行");
  });

  it("tolerates CRLF and falls back for missing fields", () => {
    const s = parseSkillFile("---\r\nname: x\r\n---\r\nbody here", "fb");
    expect(s.id).toBe("x");
    expect(s.title).toBe("x"); // falls back to id
    expect(s.category).toBeUndefined();
    expect(s.body).toBe("body here");
  });

  it("keeps colons inside a value", () => {
    const s = parseSkillFile("---\ndescription: 读/改 设置：先查后改\n---\nbody", "fb");
    expect(s.summary).toBe("读/改 设置：先查后改");
  });

  it("uses the fallback id when no frontmatter name and treats all text as body", () => {
    const s = parseSkillFile("just body, no fence", "the-folder");
    expect(s.id).toBe("the-folder");
    expect(s.body).toBe("just body, no fence");
  });

  it("round-trips through composeSkillFile", () => {
    const composed = composeSkillFile({
      id: "my-skill",
      title: "我的技能",
      category: "效率",
      summary: "一句话简介",
      body: "触发条件\n步骤\n边界",
    });
    const s = parseSkillFile(composed, "fallback");
    expect(s.id).toBe("my-skill");
    expect(s.title).toBe("我的技能");
    expect(s.category).toBe("效率");
    expect(s.summary).toBe("一句话简介");
    expect(s.body).toContain("触发条件");
    expect(s.body).toContain("边界");
  });
});
