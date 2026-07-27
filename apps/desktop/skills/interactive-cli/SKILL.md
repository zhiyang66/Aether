---
name: interactive-cli
title: 交互式 CLI 流程
category: 交互
description: 命令等待输入（Y/n、数字菜单、trust）时，用 Actions 把选项变成按钮交给用户。
---

当 run_command / read_pane 显示程序在等待输入时：
1. 用中文简要说明程序在问什么、当前窗格 #N。
2. **用 Actions skill** 为每个合理选项生成按钮（command = 用户应输入的内容）。
3. 不要代替用户做高风险选择时，把选项都列成按钮，由用户点选。
4. 用户点按钮后终端会收到对应输入；若仍停在提示，再 read_pane 继续协助。
