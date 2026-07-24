# Aether

跨平台终端工作台桌面客户端。将本机 Shell 作为执行内核，界面与终端呈现完全自研：多标签、树状分屏、真实 PTY、命令面板，以及可对接 OpenAI 兼容接口的 Agent 侧栏。

**当前版本：`0.6.0`（冻结）**

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

- **多标签会话**：按 Shell 配置文件新建标签（PowerShell / cmd / bash / zsh / WSL 等，视本机可用性扫描）
- **树状分屏**：水平 / 垂直拆分，窗格序号 `#N`，关闭窗格与焦点切换
- **真实 PTY**：每窗格独立会话；xterm 输入写入内核，输出流式渲染
- **OSC 7 cwd**：尽可能同步当前工作目录到窗格头 / 状态栏
- **命令历史与联想**：历史 / 常用命令浮层建议；xterm 与 mock 输入均支持
- **命令面板**：`Ctrl+Shift+P` 快速执行工作台动作
- **布局与工作区**：内置 / 自定义布局模板，工作区保存与切换
- **主题与外观**：主题预设、字号 / 字体 / 光标、窗口材质相关选项

### Agent

- 对接设置中的 **API Endpoint**（OpenAI 兼容），模型列表动态拉取
- 多会话：新建、切换、历史持久化
- 按窗格 **`#N` 精准**读取上下文、插入命令、执行
- 危险命令确认策略；任务模式（`/task`）与任务面板
- 扩展：导入 JSON、启用 / 移除、命令进入面板

### 输入与剪贴板

| 场景 | 快捷键 | 行为 |
|------|--------|------|
| 终端内 | `Ctrl+C` | 有选区 → 复制；无选区 → SIGINT |
| 终端内 | `Ctrl+Shift+C` | 强制复制选区 |
| 终端内 | `Ctrl+V` / `Shift+Insert` | 粘贴到 PTY |
| 终端内 | `Ctrl+L` | 清屏（视口 + 缓冲；有 PTY 时发送 `clear` / `Clear-Host`） |
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
┌─────────────────────────────────────────────────────────┐
│  呈现层（自研 UI）                                        │
│  标题栏 · 标签 · 分屏 · Agent · 设置 · Toast · 命令面板   │
│  xterm 画布（主题 / 字体 / 光标）                          │
├─────────────────────────────────────────────────────────┤
│  协议层：ANSI/VT · 键位 · resize(cols, rows) · OSC 7     │
├─────────────────────────────────────────────────────────┤
│  内核层：portable-pty + 本机 Shell（无系统终端窗体）        │
│  pwsh / cmd / bash / zsh / wsl …                         │
└─────────────────────────────────────────────────────────┘
```

**原则：Shell 只负责执行；界面只负责呈现。** 不嵌入 Windows Terminal / conhost / 系统 Terminal.app 作为主界面。

```
src/                 前端（React）
  app/               路由与根组件
  components/        命令面板、右键菜单、Toast 等
  features/          工作台、终端、设置、Agent 任务
  ipc/               Tauri 调用（PTY 等）
  lib/               布局、历史、Agent、主题等纯逻辑
  store/             Zustand 状态与持久化
src-tauri/           Rust 后端
  src/pty_host.rs    PTY 生命周期
  src/shell_scan.rs  Shell 探测
  src/agent_api.rs   Agent HTTP / 流式
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

仅前端（浏览器内 **模拟终端**，无本机 PTY）：

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
| `npm run release` | 发布辅助脚本 |

---

## 配置说明

- **设置页**：常规、Shell 配置、外观、Agent（Endpoint / API Key / 模型）、命令联想、快捷键、关于
- **API Key**：仅存本机；导入 / 导出工作台时会剥离密钥
- **会话恢复**：可选启动时恢复标签与布局（不含运行中 PTY 进程状态）
- **Agent**：需在设置中填写可用的 OpenAI 兼容 Base URL 与密钥后，才能拉模型与对话

---

## 质量与范围

- 前端单元测试：`npm test`（Vitest + happy-dom）
- 门禁：`npm run check`（`tsc` + 测试 + `vite build`）
- **0.6.0 明确不做**：远程 SSH 主机管理、云同步账号、快捷键可视化重映射编辑器、插件市场、系统终端窗体嵌入

---

## 版本与许可

- 版本号以 `package.json` / `src-tauri/tauri.conf.json` 为准（当前 **0.6.0**）
- 后续功能默认不升号，由维护者评定后再改版本
- 仓库许可：见 `src-tauri/Cargo.toml`（MIT）

---

## 仓库

- Gitee：<https://gitee.com/xxdzzy/Aether>
