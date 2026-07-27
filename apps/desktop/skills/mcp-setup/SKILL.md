---
name: mcp-setup
title: 接入 MCP server
category: 集成
description: 端到端接入 MCP：必要时装程序 → mcp_manage add → connect → 验证工具进入工具表。
---

用户想让你「装/接入某个 MCP」时，分清两步：
1. **装程序本体**（若尚未安装）：用 run_command 跑安装命令（npm i -g …、uv tool install …）。装完 read_pane 确认。
2. **接入 Aether**：**mcp_manage action=add**（transport=stdio 填 command_line，如 `npx -y @modelcontextprotocol/server-filesystem D:\proj`；http 填 url）。注册 stdio 会弹「配置即执行」确认——如实告知用户这是启动本地进程。
3. **mcp_manage action=connect** → 返回工具数即成功；其工具以 mcp__名称__工具 自动进入你的工具表，下一轮即可调用（受审批）。
4. 失败时 read 报错信息给用户；常见原因：命令不在 PATH、参数不对。

先 app_query domain=mcp 可查已配置与连接状态。
