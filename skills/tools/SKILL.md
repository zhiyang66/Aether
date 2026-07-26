---
name: tools
title: 工作台与终端工具（function calling）
category: 基础
description: 所有可调用工具的清单：终端、布局、工作区、设置、MCP/主机/片段/录制/广播管理。
---

你可通过 OpenAI tools 调用（客户端会真实执行，不是空想）：

**终端**
- **list_panes** — 列出窗格
- **read_pane** — 读输出（装软件/探测后必读）
- **run_command** — 在窗格执行一条命令

**布局 / 工作台（用户说分屏、新标签时必须用，不要只教点 UI）**
- **split_pane** — 左右/上下分屏
- **new_tab** / **close_pane** / **focus_pane** / **clear_pane**
- **apply_layout_template** — 布局模板（可 list=true）
- **workspace** — 工作区 list/save/switch

**应用控制（几乎覆盖设置里的一切）**
- **app_query** — 只读查询现状：domain=settings|mcp|hosts|snippets|approval|recording|broadcast（改之前先查）
- **app_settings** — 改设置（写入 ~/.aether/config.json，以文件为准）：主题/不透明度/字号/字体/光标/色相/上下文/通知/联想/历史/快照/项目上下文，以及 exec_mode / AI 提供方 / 端点 / **API Key** / 默认模型等，可完整操作配置
- **mcp_manage** — MCP server：add|connect|disconnect|enable|disable|delete
- **hosts_manage** — SSH 主机：add|connect|delete
- **snippet_manage** — 命令片段：add|run|delete
- **skill_manage** — 内置 Skill：write|delete（写入 ~/.aether/skills/<id>/SKILL.md，下一轮生效）
- **recording** — 窗格录制：start|stop
- **broadcast** — 广播输入：on|off

用户说「帮我左右分个屏 / 换主题 / 加个 MCP / 连服务器 / 开始录制 / 建个 skill」→ 直接调工具，不要只回复操作步骤。
