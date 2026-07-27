# Aether

以 **Agent 为核心**的跨平台终端工作台。本机 Shell 作为执行内核，界面与终端呈现完全自研：多标签、树状分屏、真实 PTY、OSC 133 命令块、对话式 Agent（工具循环）、MCP 工具生态、SSH 主机管理、会话录制回放。

**当前版本：`1.0.3`**

| 技术栈 | 用途 |
|--------|------|
| [Tauri 2](https://tauri.app/) | 桌面外壳、窗口与系统集成 |
| React 19 + TypeScript | 工作台 / 设置 UI |
| [xterm.js](https://xtermjs.org/) | 终端画布与 VT 呈现 |
| Rust + [portable-pty](https://crates.io/crates/portable-pty) | 本机伪终端与 Shell 进程 |
| Zustand | 前端状态 |
| Vite | 前端构建 |

---

## 功能概览

### 终端工作台

- **多标签会话**：按 Shell 配置新建标签（PowerShell / cmd / bash / zsh / WSL / SSH 主机，视本机可用性扫描）
- **树状分屏**：水平 / 垂直拆分，窗格序号 `#N`，焦点最大化，广播输入（多窗格同步键入）
- **真实 PTY**：每窗格独立会话；分屏 / 换布局不杀会话（会话注册表跨 React 重挂载存活）
- **命令块（OSC 133）**：Shell 集成随会话注入（pwsh / bash / zsh，对用户不可见），每条命令结构化为块——命令、退出码、耗时、cwd；失败块红色标线；窗格头块列表可跳转 / 复制命令 / 复制输出 / 重跑 / AI 诊断；`Ctrl+Alt+↑/↓` 块间跳转
- **缓冲区搜索**：`Ctrl+Shift+F`
- **完成通知**：长命令在窗口未聚焦时结束 → 系统通知（阈值可配）
- **命令历史与联想**：历史 / 常用命令浮层；命令片段（Snippets）带参数模板（设置页可建，Agent 也可建）
- **命令面板**：`Ctrl+Shift+P`，双 Tab（**内置命令** / **命令片段**）；布局模板、工作区、录制、片段全部可达
- **会话录制回放**：录制为 asciinema cast v2（Rust 侧落盘），应用内回放（进度 / 倍速）
- **SSH 主机**：以系统 `ssh` 为内核的主机管理（端口 / 用户 / 私钥 / 跳板机），主机即 Shell 配置；支持从 `~/.ssh/config` 导入

### Agent（核心）

- **流式工具内核**：OpenAI 兼容与 Anthropic 原生双协议；文本 / 思维链流式渲染，工具调用可中途取消（`/stop`）
- **万能工具组**：读窗格 / 执行命令、分屏 / 标签 / 布局 / 工作区；`app_query` / `app_settings`（含主题、执行模式、API Key 等，写入 `~/.aether/config.json`）；`mcp_manage` / `hosts_manage` / `snippet_manage` / `skill_manage` / `recording` / `broadcast`
- **内置 Skill（文件标准）**：能力简报以 `~/.aether/skills/<id>/SKILL.md` 存放（YAML frontmatter + markdown）；首次运行播种内置，用户与 Agent（`skill_manage`）均可增删改；设置 → Skill 列表可见
- **对话即操作**：直接自然语言描述需求，Agent 连续调用 `run_command` / `new_tab` / `split_pane` 等工具完成，无需单独任务面板
- **MCP 客户端**：连接 Model Context Protocol server（stdio 本地进程 / streamable HTTP），其工具以 `mcp__server__tool` 命名空间进入 Agent 工具表；调用超时与输出上限保护
- **分级审批**：保守 / 平衡 / 放手三档预设 + 规则（工具 / 命令通配 / MCP server）；每次系统级操作弹窗「允许一次 / 总是允许 / 拒绝」，危险命令强制升级询问；「总是允许」写入的规则可见可撤销
- **行内 Ctrl+K**：终端内自然语言 → 单条命令，Enter 插入 / Ctrl+Enter 执行（走危险策略）
- **项目上下文**：窗格 cwd 向上查找 `AETHER.md` 自动注入（git 根截止，8KB 上限）；命令面板可让 Agent 起草
- **失败一键诊断**：失败命令块 → 「AI 诊断」按钮 → 结构化上下文直达 Agent

### 输入与剪贴板

| 场景 | 快捷键 | 行为 |
|------|--------|------|
| 终端内 | `Ctrl+C` | 有选区 → 复制；无选区 → SIGINT |
| 终端内 | `Ctrl+Shift+C` | 强制复制选区 |
| 终端内 | `Ctrl+V` / `Shift+Insert` | 粘贴到 PTY |
| 终端内 | `Ctrl+L` | 清屏 |
| 终端内 | `Ctrl+K` | 行内自然语言生成命令 |
| 终端内 | `Ctrl+Shift+F` | 缓冲区搜索 |
| 终端内 | `Ctrl+Alt+↑/↓` | 命令块跳转 |
| 全局 | 右键菜单 | 复制 / 粘贴 / 清屏 / 分屏 / Agent / 设置 / 命令面板 |

### 工作台快捷键

| 操作 | Windows / Linux | macOS |
|------|-----------------|-------|
| 命令面板 | `Ctrl+Shift+P` | `⌘⇧P` |
| 新建标签 | `Ctrl+T` | `⌘T` |
| 关闭标签 | `Ctrl+W` | `⌘W` |
| 关闭窗格 | `Ctrl+Shift+W` | `⌘⇧W` |
| 向右分屏 | `Alt+Shift+D` | `⌥⇧D` |
| 向下分屏 | `Alt+Shift+E` | `⌥⇧E` |
| 切换窗格 | `Ctrl+Alt+←/→` | `⌘⌥←/→` |
| Agent 面板 | `Ctrl+Shift+A` | `⌘⇧A` |
| 清屏 | `Ctrl+L` | `⌘L` |
| 设置 | `Ctrl+,` | `⌘,` |
| 焦点最大化 | `Ctrl+Shift+M` | `⌘⇧M` |

完整列表见应用内 **设置 → 快捷键**。

---

## 架构

```
┌──────────────────────────────────────────────────────────┐
│  呈现层（自研 UI）                                         │
│  标题栏 · 标签 · 分屏 · Agent · 设置 · 命令面板             │
│  xterm 画布 · 命令块装饰 · 搜索 · 行内 Ctrl+K · 回放器      │
├──────────────────────────────────────────────────────────┤
│  协议层：ANSI/VT · OSC 7 cwd · OSC 133 命令块 · resize     │
│  Agent：OpenAI 兼容 / Anthropic 流式 · 工具调用 · 审批      │
├──────────────────────────────────────────────────────────┤
│  内核层：portable-pty + 本机 Shell（无系统终端窗体）         │
│  pwsh / cmd / bash / zsh / wsl / ssh …                    │
│  MCP host（stdio / http） · cast 录制落盘                  │
└──────────────────────────────────────────────────────────┘
```

**原则：Shell 只负责执行；界面只负责呈现。** 不嵌入系统终端窗体；不自实现 SSH 协议（`ssh` 可执行文件即内核）。

```
src/                    前端（React）
  app/                  路由与根组件
  components/           命令面板、审批弹窗、回放器、Toast 等
  features/workbench/   标签 / 分屏 / Agent 面板 / 状态栏
  features/terminal/    XtermHost · 行内 Ctrl+K · 会话注册表
  features/settings/    设置各面板（Agent / 审批 / MCP / Skill / SSH / 片段…）
  ipc/                  Tauri 调用封装
  lib/                  命令块 / 审批 / 片段 / MCP / SSH / Skill 等纯逻辑（含单测）
  store/                Zustand 状态与持久化（设置写穿 ~/.aether/config.json）
skills/                 内置 Skill 真源（SKILL.md，编译时 include + Vite 回退）
src-tauri/              Rust 后端
  src/pty_host.rs       PTY 生命周期（+ 录制分流）
  src/shell_scan.rs     Shell 探测
  src/shell_integration.rs  OSC 133/7 注入脚本（spawn 时注入）
  src/agent_api.rs      Agent HTTP / 流式 / 工具调用（OpenAI 兼容 + Anthropic）
  src/mcp_host.rs       MCP server 运行时（stdio / http）
  src/recorder.rs       asciinema cast v2 录制
  src/aether.rs         ~/.aether 配置主目录（skills / config.json）
```

---

## 环境要求

| 依赖 | 说明 |
|------|------|
| Node.js | 建议 20+ |
| Rust | 建议 1.77+（Tauri 2） |
| 平台工具链 | [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)（Windows：MSVC / WebView2 等） |

---

## 快速开始

```bash
# 安装前端依赖
npm install

# 桌面端开发（Vite + Tauri，真 PTY）
npm run tauri:dev
```

仅前端（浏览器内 **模拟终端**，无本机 PTY / MCP / 录制）：

```bash
npm run dev
```

### 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run tauri:dev` | 开发模式启动桌面应用 |
| `npm run tauri:build` | 打包安装包 / 可执行文件 |
| `npm run build` | 仅构建前端 `dist/` |
| `npm test` | 单元测试（Vitest） |
| `npm run check` | TypeScript + 测试 + 生产构建 |
| `cargo test --lib`（`src-tauri/`） | Rust 单元测试 |
| `npm run release` | 发布辅助脚本 |

---

## 配置说明

- **配置主目录 `~/.aether/`**（类似 `~/.codex` / `~/.claude`）：
  - `config.json` — 设置权威源（含主题、字号、Agent 端点 / API Key 等；启动时以文件为准）
  - `skills/<id>/SKILL.md` — Agent 内置 / 用户 Skill（YAML frontmatter + markdown；首次运行播种内置）
- **设置页**：常规、Shell 配置、SSH 主机、外观、工作区、Agent、审批、MCP、Skill、命令联想、命令片段、快捷键、关于
- **敏感数据只存本机**：API Key、SSH 私钥路径、MCP env 均不随「导出设置 / 导出工作台」离开本机（分享路径仍脱敏）
- **Agent**：填写 OpenAI 兼容 Base URL（或 Anthropic 端点）与密钥后拉取模型；也可让 Agent 通过 `app_settings` 直接写入
- **审批**：默认「平衡」档——工作台内操作放行、执行命令 / MCP 调用询问；危险命令永远至少询问
- **更新**：设置 → 关于 配置 version.json 更新源；启动后台静默检查 + 手动检查

---

## 质量与范围

- 前端单元测试：`npm test`（Vitest + happy-dom，含命令块 / 审批 / 片段 / SSH / Skill / 设置合并等）
- Rust 单元测试：`cargo test --lib`（协议转换 / Shell 注入 / MCP 解析 / 录制格式 / `~/.aether` frontmatter）
- 门禁：`npm run check`（`tsc` + 测试 + `vite build`）
- **1.0 明确不做**：SSH 协议自实现、云同步账号、插件市场、系统终端窗体嵌入、自动静默安装更新（更新为提示 + 打开下载页）、Skill 可视化编辑器

---

## 版本与许可

- 版本号以 `package.json` / `src-tauri/tauri.conf.json` 为准（当前 **1.0.3**，应用内「关于」页同步显示）
- 跨平台桌面应用（Tauri）；本仓库 Release 附带当前环境可产出的安装包，其它平台可从源码构建
- 更新检查默认对接 GitHub Releases（`设置 → 关于 → 检查更新`；更新源留空即可）
- 发布标签：
  - [`v0.6.0`](https://github.com/zhiyang66/Aether/releases/tag/v0.6.0) — 早期基线
  - [`v1.0.0`](https://github.com/zhiyang66/Aether/releases/tag/v1.0.0) — 1.0 稳定版
  - [`v1.0.1`](https://github.com/zhiyang66/Aether/releases/tag/v1.0.1) — 窗格寻址 / 审批浮窗 / 红绿灯样式
  - [`v1.0.2`](https://github.com/zhiyang66/Aether/releases/tag/v1.0.2) — 设置搜索 / WebGL / 多窗格与 Actions
  - [`v1.0.3`](https://github.com/zhiyang66/Aether/releases/tag/v1.0.3) — 当前：去掉任务系统 · 默认 GitHub 检查更新
- 仓库许可：见 `src-tauri/Cargo.toml`（MIT）

---

## 仓库

- GitHub：<https://github.com/zhiyang66/Aether>
- Gitee：<https://gitee.com/xxdzzy/Aether>
- Releases：<https://github.com/zhiyang66/Aether/releases>
