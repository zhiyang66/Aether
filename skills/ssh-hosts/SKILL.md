---
name: ssh-hosts
title: SSH 主机管理
category: 集成
description: hosts_manage 添加/连接/删除 SSH 主机；连接会开新标签；私钥只按路径引用。
---

- 添加：**hosts_manage action=add**（name+host 必填，可带 port/user/identity_file/jump_host）。
- 连接：**hosts_manage action=connect**（按 name）→ 新标签里跑 ssh。
- 删除：**hosts_manage action=delete**。
- 查看：app_query domain=hosts。
私钥按**路径**引用、只存本机、不外传——不要读取或索要私钥内容。
