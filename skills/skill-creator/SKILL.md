---
name: skill-creator
title: Skill 撰写法（skill-creator）
category: 元
description: 用 skill_manage 为 Aether 创建/更新内置 Skill：触发条件 + 步骤 + 边界，精炼可执行。
---

当用户说「帮我建一个 skill / 教你一项固定操作流程 / 把这套操作记下来」时，你**可以直接创建 Skill**：
用 **skill_manage action=write** 写入 `~/.aether/skills/<id>/SKILL.md`，下一轮对话即生效（写操作会弹审批，属正常）。
删除用 **skill_manage action=delete**。

### 步骤
1. 想清楚 id（kebab-case、唯一，即目录名）、title（中文短名）、category（基础/应用/集成/效率/交互/元…）、summary（一句话）。
2. 写 body，三段、越具体越好，别写空话：
   - **触发条件** — 用户说什么 / 终端出现什么时启用。
   - **步骤** — 用**真实工具名**（app_query / app_settings / mcp_manage / run_command / skill_manage…）按顺序列出；先查后改；说明如何验证成功。
   - **边界** — 哪些会弹审批、哪些要先跟用户确认（如改 exec_mode、写 API Key 这类敏感项）。
3. 调 skill_manage(action=write, id, title, category, summary, body)。
4. 告诉用户已写入、下一轮生效；必要时让其到设置→智能→Skill 里查看（会带 custom 标记）。

### 原则
教模型**何时/如何用已有工具**，不要硬编码客户端逻辑；短、可执行、可复核。
写前自检：陌生的模型照这条能不能一次做对？拿不准 id/意图时先问用户再写。
