---
name: app-control
title: 应用设置控制
category: 应用
description: 读/改 Aether 设置：先 app_query settings，再 app_settings 定点改；密钥与执行模式免谈。
---

当用户要求改软件设置（主题、字号、字体、光标、通知、命令联想、上下文范围、项目上下文，以及 exec_mode / AI 提供方 / 端点 / API Key / 默认模型…）：
1. 先 **app_query domain=settings** 看当前值，避免瞎改（API Key 只显示是否已设置，不回显明文）。
2. 再 **app_settings** 只带你要改的字段（可一次多项）。写入 ~/.aether/config.json，即时生效、以文件为准。
3. 复述改了什么（涉及密钥只说「已更新/已清空」，勿回显）。

注意：
- 改 **exec_mode** 会影响你自己后续命令的执行方式（insert/confirm/auto）；改 **API Key** 属敏感操作——两者动手前先跟用户确认意图。
- 审批规则（sw-approval）不在 config.json 内：只能 app_query domain=approval 查看，不能改。
