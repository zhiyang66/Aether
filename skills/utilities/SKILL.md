---
name: utilities
title: 片段 / 录制 / 广播
category: 效率
description: snippet_manage 存跑常用命令、recording 录制窗格、broadcast 多窗格同输入。
---

- **片段**：snippet_manage action=add（template 用 {name} 占位）| run（带 values 填参，写入焦点窗格，受命令危险策略约束）| delete。查看用 app_query domain=snippets。
- **录制**：recording action=start|stop（可带 serial，省略=焦点窗格），生成 asciinema cast。
- **广播输入**：broadcast action=on（serials 或当前标签全部，≥2 窗格）| off。开启后键入会同发多个窗格，操作后记得按需 off。
这些写操作会触发审批弹窗，属正常。
