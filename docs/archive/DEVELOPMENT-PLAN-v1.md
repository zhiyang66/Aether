# Shell Workbench — V1 完整开发方案

> 版本：0.5 · 日期：2026-07-23
> 状态：**V1 一次做完**（不以「能跑就行」的半成品交付）
> 视觉与交互真源：`prototype/`（冲突时 **以 HTML/CSS/JS 行为为准**）
> 产品：跨平台终端工作台 = 多标签 + 树状分屏 + 真 PTY + Agent + 命令联想 + 设置
> **内核 / 外观分离**：本机 Shell **只作执行内核**；**全部 UI 与终端呈现样式** 使用我方设计（prototype），不使用系统终端窗体外观
> **Agent 模型**：列表从设置页配置的 **API 端点** 动态拉取（非写死 Fable/Opus 等）
> **Agent 会话**：支持 **新会话** + **历史会话列表**（本地持久化，可切换/删除）
> **Agent 窗格寻址**：可按分屏 **窗格序号 #N** 精准读取与插入/执行（见 §4.6.7）

---

## 0. V1 交付定义（Definition of Done）

**第一个版本必须全部完成**，满足下列全部条件才算 V1 完成：

| # | 条件 |
|---|------|
| 1 | 工作台、设置两页 **GUI 1:1 还原** prototype（见 §2），固定分辨率截图叠图可验收 |
| 2 | prototype 中 **全部可点击交互** 均已实现，且语义与 HTML 脚本一致（见 §4） |
| 3 | 终端为 **本机真实 PTY/Shell 内核**，非假 `run()`；**呈现层为我方样式**（见 §1.0），非系统 Terminal/Windows Terminal/iTerm 窗体嵌入 |
| 4 | Agent **可读全部窗格**；可按 **#N 窗格序号** 精准读/插/跑；**模型列表从 endpoint 拉取**；**新会话 + 历史会话列表** |
| 5 | **历史/常用命令联想** 可用并持久化 |
| 6 | 设置项 **按实际能力展示且全部生效**（见 §5） |
| 7 | 会话布局可恢复；配置与 API Key 本机持久化 |
| 8 | Windows 可安装运行（macOS / Linux 同步支持为 V1 目标；若某平台 Shell 探测差异，行为降级须在设置中可见） |
| 9 | 体积/启动优于 Electron 基线预期（Tauri）；无原型外的设计系统换皮 |

**V1 明确不做**（避免范围膨胀）：

- 远程 SSH 主机管理、同步账号/云配置
- 快捷键可视化重映射编辑器（仅内置绑定 + 设置页表格展示）
- 插件市场、主题商店
- 纯 Rust 原生 UI 重绘
- **嵌入或弹出系统终端窗口**（conhost、Windows Terminal、Terminal.app 等）充当主界面

**V1 相对 prototype 的增强**（HTML 无完整实现、产品已要求，必须进 V1）：

| 增强 | 说明 |
|------|------|
| 真 PTY 内核 | 替换假 Shell `run()`；仍只吃字节流，不借用系统终端 UI |
| 我方终端呈现 | xterm + prototype 配色/字体/窗格铬合金；设置可调字号/光标等 |
| 真 Agent API | 替换规则式 `agentReply`；读权限全开 |
| 模型列表动态化 | 工作台模型菜单 = 请求设置中 endpoint 的 models 列表（见 §4.6.2） |
| Agent 会话管理 | 新会话、历史列表、切换、删除、本地持久化（见 §4.6.6） |
| 窗格序号精准控制 | Agent 以 #N 定位分屏 leaf：读上下文、插入、执行均落到指定序号（见 §4.6.7） |
| 命令联想 | 历史 + 常用，输入浮层（我方浮层样式） |
| 设置真实存盘 | 替换 toast 模拟 |
| 系统窗口 | 真 min/max/close（去掉浏览器假窗口必要差异，见 §2.4） |

---

## 1.0 架构原则：原生 Shell 内核 × 自研外观（强制）

> **Shell 只负责「算」；界面只负责「画」。**
> 用户看到的永远是 Shell Workbench 的设计语言，不是系统终端皮肤。

### 1.0.1 分层

```
┌─────────────────────────────────────────────────────────────┐
│  呈现层（100% 我方设计 · 1:1 prototype）                      │
│  · 应用铬：标题栏 / 标签 / 分屏 gutter / Agent / 设置 / Toast │
│  · 终端画布：xterm.js + tokens（--term-bg/fg、字体、光标）    │
│  · 联想浮层、窗格 #N 徽标、状态栏 —— 均非系统终端控件          │
├─────────────────────────────────────────────────────────────┤
│  协议层：ANSI / VT 序列、输入键位、resize(cols,rows)          │
├─────────────────────────────────────────────────────────────┤
│  内核层（本机原生 Shell · 无窗口）                            │
│  · PTY 会话挂载：pwsh / bash / zsh / cmd / wsl …             │
│  · 只提供进程 + stdin/stdout/stderr + 环境/cwd               │
│  · 不创建、不嵌入系统终端 UI                                  │
└─────────────────────────────────────────────────────────────┘
```

| 层 | 用什么 | 不用什么 |
|----|--------|----------|
| 内核 | 本机 `pwsh.exe`、`bash`、`cmd.exe` 等可执行文件 + PTY | 假 JS 命令表冒充执行 |
| 外观 | prototype CSS/DOM、xterm 主题、设置里的强调色/字体/光标 | 系统 Terminal 主题、conhost 默认蓝底白字窗体、外部 WT 标签栏 |
| 交互壳 | 多标签、树状分屏、Agent、联想 | 把 Windows Terminal / iTerm 嵌成 WebView 主界面 |

### 1.0.2 产品表述（可对外）

- **是**：在自研工作台里跑真实 PowerShell / Bash / …
- **不是**：套壳打开系统终端，或把系统终端 UI 嵌进来

关于页架构文案对齐：

```text
外壳 UI（我方设计）→ PTY → 本机 Shell 内核
```

### 1.0.3 终端画布样式归属

即使内部是真实 Shell 输出，**像素归属仍是我方**：

| 元素 | 样式来源 |
|------|----------|
| 背景/前景/ANSI 映射 | `--term-bg` / `--term-fg` / accent 体系；xterm `theme` 显式配置 |
| 字体与字号 | 设置「外观」→ Cascadia 等栈 + 11–20px（默认 13） |
| 光标 | 竖线/方块/下划线 + 闪烁（设置） |
| 窗格头 | `#N`、shell 短名、cwd、关闭钮 —— prototype `.pane-header` |
| 选区/滚动条 | 尽量贴近工作台深色；避免系统默认突兀白条（可 CSS/overlay） |
| 命令联想浮层 | 自研组件，token 与 Agent 菜单一致 |
| Prompt 内容 | **由 Shell 内核决定**（用户 profile 可改 prompt 文本）；**颜色渲染**仍走 xterm + 我方 theme（Shell 自带 ANSI 色映射到 theme） |

### 1.0.4 实现约束

1. PTY 以 **无界面子进程** 启动（隐藏 console 窗口；Windows 避免弹出独立 conhost 窗）。
2. 所有用户可见字符经 **xterm 绘制**，不出现第二套系统终端窗口作为主编辑区。
3. 换 Shell（ps→bash）只换 **内核 profile**，**不换** 工作台铬与 xterm 主题框架。
4. 设置「外观」只影响呈现层；不修改系统 Terminal 全局主题。
5. 验收时对比：截图应像 **prototype 终端区**，而不是像默认 PowerShell 窗口。

---

## 1. 目标与技术选型

### 1.1 产品目标

| 目标 | 说明 |
|------|------|
| GUI 1:1 | 搬迁 prototype CSS/DOM，不重设计 |
| 交互对齐 | 先实现 HTML 里已有交互，再接真后端 |
| 内核真 · 外观自研 | 本机 Shell 只作 PTY 内核；**全部可见样式为我方设计**（§1.0） |
| 真执行 | UI → xterm 呈现 → PTY → 本机 Shell（非假 run） |
| 快且小 | Tauri 2，优先包体与启动 |

### 1.2 技术栈（已定）

| 层 | 选型 | 说明 |
|----|------|------|
| 壳 | **Tauri 2** | 体积小、启动快 |
| UI | **React 18+ · TypeScript · Vite** | 拆组件但保留 class |
| 样式 | **从 HTML 原样抽出的 CSS** | 禁止 Tailwind 换皮；token 用 prototype 的 oklch |
| 终端呈现 | **xterm.js** + fit / web-links | **我方画布**；挂在 `.pane-body`；theme ← tokens/设置 |
| PTY 内核 | **Rust**（`portable-pty` / ConPTY） | 每 leaf 一会话；无系统终端 UI |
| 状态 | Zustand 或等价 | tabs / layout / ai / settings |
| 路由 | React Router：`/` 工作台，`/settings` 设置 |
| 配置 | JSON（userData）+ 密钥走 OS 安全存储 | |
| Agent | Rust 侧 HTTP 代理流式响应 | Key 不出明文日志 |

### 1.3 仓库结构

```
aether/
  prototype/                      # 视觉与交互真源（只读对照）
  docs/
    DEVELOPMENT-PLAN.md           # 本文
  apps/desktop/
    package.json
    index.html
    vite.config.ts
    src/
      main.tsx
      app/
        App.tsx                   # 路由
        routes.tsx
      styles/
        tokens.css                # :root 从两页 HTML 合并
        workbench.css             # shell-workbench 样式原样
        settings.css              # settings 样式原样
        xterm-bridge.css          # 仅 xterm 宿主最小覆盖
      features/
        workbench/                # 工作台页面与逻辑
        settings/
        agent/
        terminal/                 # xterm 封装
        suggest/                  # 命令联想
      components/                 # 按布局区域拆，class 对齐原型
      store/
      lib/
        layout.ts                 # 移植 split/remove/map 算法
        shells.ts
      ipc/
        types.ts
    src-tauri/
      src/
        main.rs
        pty/
        shell_scan/
        history/
        settings/
        agent/
        session/
      tauri.conf.json
      Cargo.toml
```

---

## 2. GUI 1:1 还原规范（强制）

### 2.1 总原则

> **先搬迁，再接线。**
> 框架只拆文件与接数据；**class 名、DOM 层级、CSS 规则以 prototype 为准。**

| 允许 | 禁止（V1） |
|------|------------|
| 将 `<style>` 抽到 css 文件 | 用 UI 库/默认主题重写外观 |
| 将脚本改为 React 事件 | 为「组件化」随意改 DOM 层级 |
| 动态列表用 `map` | 把 `.titlebar` 改成无协议的 `flex h-8` |
| xterm 替换 `.pane-body` 内部 | 改掉 `.pane` / `.pane-header` 外壳 |
| 系统窗口替代假 windowed 框 | 改 oklch token、圆角、字号节奏 |

### 2.2 实施顺序（视觉）

```
1. 冻结黄金截图（prototype @ 1366 / 1440 / 1920）
2. 原样抽出 tokens + workbench.css + settings.css
3. 静态壳 1:1（写死 seed 数据，与原型初始布局一致）
4. 叠图 diff，修到可接受阈值
5. 再移植交互状态机（仍不改 CSS）
6. 再替换 PTY / Agent / 存盘
```

### 2.3 组件拆分方式

按 **布局区域** 拆，每个组件 return 的 DOM 尽量是原型片段：

```
WorkbenchPage
├── RestoreChip                 # 仅当需要桌面等价物时；见 §2.4
├── Titlebar
├── Workspace
│   ├── MainCol
│   │   ├── Tabbar (+ ShellMenu)
│   │   └── PanesHost
│   │         ├── SplitGroup
│   │         └── Pane (header + TerminalHost + SuggestOverlay)
│   └── AiPanel
├── Statusbar
└── Toast

SettingsPage
├── Titlebar
├── Body
│   ├── Sidebar (+ search)
│   └── Content → PanelGeneral | Shells | Appearance | Ai | Completion | Shortcuts | About
└── FooterBar
```

### 2.4 桌面端白名单差异（不算还原失败）

| 点 | Prototype | V1 客户端 |
|----|-----------|-----------|
| 窗口 | 页面内 `.app.windowed` 假窗口 + restore-chip | **系统无边框窗口**；内容区 100% 铺满；真 min/max/close |
| 最小化/关闭 | CSS 隐藏 + 底部 chip | 系统任务栏；**不实现**浏览器式 restore-chip（避免假桌面） |
| 终端内部 | `div.term-line` 文本 | xterm 画布；**配色/字号/padding 对齐 token**（仍是我方皮肤，非系统终端 UI） |
| 设置关闭 | `<a href="shell-workbench.html">` | 路由回 `/` 或关设置视图 |
| 字体 | 依赖本机 | 字体栈同原型；缺失则回退；可选后续内嵌 |

**除此之外** 的间距、颜色、图标 SVG、AI 宽度、tab 高度等必须与 HTML 一致。

### 2.5 关键几何 token（摘自原型，禁止擅自改）

```text
--titlebar-h: 32px
--tabbar-h: 38px
--statusbar-h: 24px
AI 默认宽: 360px，拖拽范围 280–520px
--radius: 6px
字体: Segoe UI Variable + Cascadia Code / JetBrains Mono / Consolas
色板: oklch 深色体系（见 prototype :root）
```

### 2.6 视觉验收

| 方法 | 标准 |
|------|------|
| 黄金截图叠图 | 工作台 + 设置，至少 1440×900 |
| 测量 | 标题栏/标签栏/状态栏高度误差 0（整像素） |
| 自动（可选） | pixelmatch 不同像素比例阈值 ≤ 0.15%（xterm 区域可 mask） |
| 字重 | 保留 510 / 550 / 590 等，不得一律改成 500/600 |

---

## 3. 原型地图与信息架构

| 文件 | 角色 |
|------|------|
| `prototype/index.html` | 跳转工作台；应用启动直接进 `/` |
| `prototype/shell-workbench.html` | 主工作台 + 全部终端/分屏/Agent 交互 |
| `prototype/settings.html` | 设置全部分类 |
| `DESIGN-HANDOFF.md` / `DESIGN-MANIFEST.json` | 设计合同辅助 |

```
启动 → Workbench
         ├─ 齿轮 / Ctrl+,  → Settings
         └─ 设置「返回工作台」/ 关闭 → Workbench
```

---

## 4. 功能规格（以 HTML 交互为纲，补全 V1）

以下按模块列出：**原型行为** → **V1 实现**。凡原型有的，必须做；标注「增强」的为 V1 必做补全。

### 4.1 窗口与标题栏

| 交互 | 原型 | V1 |
|------|------|-----|
| 标题栏展示 | 图标 SW +「Shell Workbench · 跨平台终端」 | 同文案与样式 |
| 水平分屏按钮 | `btn-split-h` 焦点窗格向右 50% | 同 |
| 垂直分屏按钮 | `btn-split-v` 焦点窗格向下 50% | 同 |
| Agent 开关 | `btn-ai` 切换侧栏 | 同 + 持久化开合 |
| 设置 | 链到 settings | 路由 `/settings` |
| 最小化 | 假状态 | `window.minimize` |
| 最大化/还原 | 切换 windowed/maximized | `toggleMaximize`；图标 normal/restore 切换同 CSS |
| 关闭 | 假 closed | `window.close`（多标签确认见设置） |
| 标题栏双击 | 最大化 ↔ 窗口化 | 同系统行为 |
| Toast | 操作反馈 ~1.8s | 同文案风格与样式 |

### 4.2 标签栏与 Shell 菜单

| 交互 | 原型 | V1 |
|------|------|-----|
| 标签列表 | 动态渲染，active 态 | 同 |
| 标签文案 | 多窗格时 `名称 · N` | 同 |
| 色点 | shellKey 对应 `.tab-dot` | 同 |
| 关闭标签 | 标签上 ×；至少一个标签 | 同；最后一个按设置「关窗/新建会话」 |
| 新建 `+` | 打开 `#shell-menu` | 同 |
| 菜单项 | PS / Bash / Zsh / cmd | 同；**增强**：探测到则显示 WSL |
| 点击外部关闭菜单 | 有 | 同 |
| 清屏按钮 | 清焦点窗格 | 真终端 clear 显示缓冲 + 可选 form feed |

**Shell 定义（V1）：**

| key | 名称 | 典型路径（按平台扫描） |
|-----|------|------------------------|
| ps | PowerShell 7 | `pwsh` |
| bash | Bash | `/bin/bash`、Git Bash |
| zsh | Zsh | `/bin/zsh` |
| cmd | 命令提示符 | `cmd.exe` |
| wsl | WSL · Ubuntu（若存在） | `wsl.exe` |

### 4.3 分屏布局引擎（核心，必须与原型算法一致）

**数据模型：**

```ts
type LayoutNode =
  | {
      type: "leaf"
      id: string
      serial: number
      shellKey: ShellKey
      ptyId?: string
      draft: string
      cmdHistory: string[]
      histIdx: number
    }
  | {
      type: "split"
      id: string
      dir: "h" | "v"
      ratio: number
      a: LayoutNode
      b: LayoutNode
    }

type Tab = {
  id: string
  title: string
  shellKey: ShellKey
  layout: LayoutNode
  activePaneId: string
}
```

| 规则 | 规格 |
|------|------|
| 拆分 | 仅拆 **焦点 leaf**；`ratio = 0.5`；dir h=左右，v=上下 |
| 上限 | `MAX_PANES = 6`，超出 toast |
| 关闭窗格 | `removeLeaf`；sibling 提升；仅 1 叶时 toast 不可关 |
| 焦点 | 点击窗格 / focus 输入 → `active-pane` + 状态栏 + Agent「焦点 · 窗格 #N」 |
| gutter | pointer 拖动改 ratio；最小约 100px；拖动中节流 PTY resize |
| 序号 | **窗格序号 `serial`**：全局递增整数，UI 显示为 `#1` `#2`…；供用户与 Agent **精准寻址**；关闭后 **不复用** 该数字（与原型一致） |
| 序号可见性 | 每个 pane-header 固定展示 `#N`；状态栏「焦点 #N」；Agent 头「焦点 · 窗格 #N」 |

算法直接移植原型：`collectLeaves` / `findLeaf` / `mapLayout` / `removeLeaf` / `splitLeaf`。
**查找契约：** 任意时刻 `serial → leaf` 映射必须 O(遍历 leaves) 可解析；Agent 与插入/运行 API **只认 serial（及内部 paneId）**，不认「左边/上边」等模糊方位（方位仅作 layoutSummary 辅助描述）。

### 4.4 终端（V1 = 真 PTY 内核 + 我方呈现）

> 参见 **§1.0**。本机 Shell 只提供执行与字节流；**用户看见的终端区域必须是 prototype 风格的自研画布。**

| 能力 | 规格 |
|------|------|
| 内核 | 每 leaf 一个隐藏 PTY + 本机 shell 进程（ps/bash/zsh/cmd/wsl） |
| 显示 | **仅** xterm 置于 `.pane-body`；主题色 = `--term-*` + 设置强调色映射 |
| 不显示 | 系统 conhost / Windows Terminal / 系统 Terminal.app 主窗口 |
| 输入 | 键位经 xterm → PTY；IME 正常 |
| Enter | 提交到内核；记录命令历史；更新联想库 |
| ↑↓ | 无联想浮层时：浏览历史；有浮层时：移动建议项 |
| Ctrl+L | 清屏（呈现缓冲；按需 form feed） |
| Ctrl+C | 有选区复制；否则向内核 SIGINT |
| Ctrl+V / 右键 | 粘贴（系统剪贴板） |
| 选区复制 | 可配置是否含提示符（设置） |
| 滚动 | xterm scrollback（如 5000 行），镜像环形缓冲供 Agent |
| 尺寸 | ResizeObserver → fit → `pty.resize` |
| cwd | OSC 7 或 shell 集成；**展示**在 pane header / 状态栏（我方 DOM） |
| 退出码 | 可选；进程退出时在我方 UI 提示并可「重开会话」 |
| 连接提示 | 可用简短 info 行；禁止用假 `ls` 数据冒充内核输出 |

**禁止：**

- V1 用假命令表冒充 Shell 执行
- V1 用系统终端窗口顶替 `.pane-body` 呈现
- 弹出未隐藏的额外 console 窗口干扰「单一自研外观」

**允许：**

- Shell 用户 profile 自定义 prompt **文本/ANSI**（属内核）；颜色落入我方 xterm theme
- 设置中改字体/字号/光标/强调色（只动呈现层）

### 4.5 命令历史与常用联想（V1 必做增强）

| 能力 | 规格 |
|------|------|
| 记录 | 每条成功提交的命令写入历史（按 shell 分桶可选） |
| 常用 | `count` + `lastUsedAt` 排序 |
| 浮层 | 输入时 debounce 50–100ms；最多 N 条（默认 8） |
| 匹配 | 默认前缀；设置可开模糊 |
| 来源标记 | 历史 / 常用 / 本会话 |
| 键位 | ↑↓ 选择，Tab 或 Enter 接受（接受策略见设置） |
| Esc | 关闭浮层 |
| 持久化 | `command-history.json`，上限默认 5000，LRU 淘汰 |
| 过滤 | 空行、超长行；可选不记录疑似 secret |

### 4.6 Agent 侧栏

#### 4.6.1 UI（对齐原型）

| 元素 | 行为 |
|------|------|
| 开合 | 标题栏按钮；class `open`；宽 CSS 变量 |
| 拖宽 | 左缘 `ai-resize`，280–520 |
| 标题 | Agent + 在线徽标 + 焦点窗格 |
| 消息流 | user / assistant 气泡 |
| 建议 chip | 三枚默认 prompt，点击即发送 |
| 输入 | textarea，Enter 发送，Shift+Enter 换行 |
| 模型菜单 | 树形：模型列表（**来自 endpoint**）+ 推理强度 + 重置默认 |
| 会话 | **新会话**按钮 + **历史会话**入口/列表（见 §4.6.6） |
| 动作 | 「插入并运行」「仅插入」 |

#### 4.6.2 模型列表与推理（从设置 endpoint 拉取）

> **禁止**在客户端写死 Fable / Opus / Sonnet / Haiku 作为唯一模型源。
> 原型中的固定模型名 **仅作 UI 示意**；V1 以设置页配置为准。

**数据流：**

```
设置页：提供方 + API 端点 + API Key（+ 可选默认模型）
        ↓ 保存 / 刷新
Rust AgentProxy：GET {endpoint}/models（或提供方等价路径）
        ↓ 解析 id / 展示名
工作台 Agent 模型菜单：动态渲染列表 → 用户选择 → 写入当前会话 + settings.lastModelId
发送消息：使用当前选中 model id + 推理强度
```

| 项 | 规格 |
|----|------|
| 列表来源 | **设置中的 API 端点** + Key；Rust 侧请求，避免 CORS/泄密 |
| 协议适配 | **OpenAI 兼容**：`GET {base}/models` → `data[].id`；**Anthropic**：按官方 models 列表 API（若不可用则设置内「手动模型 ID」+ 刷新失败时回退）；**自定义**：同一 OpenAI 兼容约定优先 |
| 触发刷新 | ① 设置保存成功后；② 设置页「刷新模型列表」按钮；③ 工作台打开模型菜单且缓存过期（默认 5–15 min）或列表为空 |
| 缓存 | 内存 + 可选磁盘缓存上次成功列表（断网时展示缓存并标「可能过期」） |
| 展示 | 菜单用 `id` 或友好 `owned_by/id` 短名；触发器文案 = `短名 + 推理强度`（对齐原型布局） |
| 当前选中 | `settings.selectedModelId`；若列表刷新后该 id 不存在 → 清空并提示重新选择，或回退列表第一项并 toast |
| 默认模型字段 | 设置中保留「模型 ID」输入框：用于 **手动指定** / 列表失败时的 fallback，**不是**唯一来源；有列表时以下拉选择为准 |
| 拉取失败 | toast + 菜单内错误行「无法加载模型 · 检查端点与 Key」；仍允许用手动模型 ID 发送（若已填） |
| 推理强度 | 仍为低 / 中 / 高 / 最高（本地枚举）；映射为 temperature / effort 等，按提供方适配；与模型列表独立 |
| 重置默认 | 恢复默认推理强度 + 清除到「默认模型 ID」（设置项）或列表第一项 |

**设置页配套控件（§5.4）：**

| 控件 | 作用 |
|------|------|
| API 端点 | 列表与对话请求的 base URL |
| API Key | 鉴权 |
| 刷新模型列表 | 立即 `models.list` |
| 默认/当前模型 ID | 手动覆盖或 fallback |
| 最近拉取状态 | 成功时间 / 失败原因（只读一行即可） |

#### 4.6.3 读权限（产品要求：完全可读）

每次对话组装 `ContextBundle`：

```ts
type PaneContext = {
  serial: number            // 分屏窗格序号，UI 为 #N —— Agent 精准控制主键
  paneId: string
  shellKey: ShellKey
  cwd: string
  isFocused: boolean
  isActiveTab: boolean
  tabId: string
  tabTitle: string
  draftInput: string
  commandHistory: string[]
  scrollback: string
  lastCommand?: string
  selection?: string
}

type ContextBundle = {
  focusSerial: number
  layoutSummary: string     // 如「#1 | (#2 / #3)」便于模型理解空间关系
  paneIndex: { serial: number; shellKey: string; cwd: string }[]  // 轻量索引，必带
  panes: PaneContext[]      // 按 scope 展开的正文
  scope: "focus" | "activeTab" | "allTabs"
}
```

| 规则 | 规格 |
|------|------|
| 默认范围 | 当前标签 **全部** 窗格（设置可改） |
| 含 draft | 默认开 |
| 输出行数 | 默认 80 行/窗格（设置 20–200） |
| 序号索引 | **每次请求必带** `paneIndex`（所有可见/范围内窗格的 serial 列表），即使某窗格正文被截断 |
| `#N` | 用户话术与模型输出中的窗格引用；解析与执行规则见 **§4.6.7** |
| 工具（V1 建议实现） | `list_panes` / `get_pane(#N)` / `run_in_pane(#N, cmd)` / `insert_in_pane(#N, cmd)` |

#### 4.6.4 写权限

| 模式 | 行为 |
|------|------|
| 仅插入 | 写入 **目标窗格**（见 §4.6.7 解析）的输入缓冲，不执行 |
| 确认后运行 | 对 **目标窗格** 弹确认后 `pty.write`+回车 |
| 自动运行 | 对 **目标窗格** 直接执行（危险命令仍可拦截） |

危险命令启发式：`rm -rf`、`format`、`mkfs`、`Remove-Item -Recurse -Force`、磁盘清理等。

**写操作必须绑定 `targetSerial`（或等价 paneId）**，禁止「只写焦点、忽略用户说的 #2」。

#### 4.6.5 流式与失败

- 流式输出到 **当前会话** 的 assistant 气泡
- 失败 toast + 气泡内错误摘要
- 发送中禁用按钮，可二次点击取消（若支持 abort）

#### 4.6.6 Agent 会话：新会话 + 历史列表（V1 必做）

> 与「终端标签会话」分离：此处指 **Agent 对话线程**（chat session）。

**能力：**

| 能力 | 规格 |
|------|------|
| 新会话 | 一键创建空线程；生成 `sessionId`；消息区清空；可保留当前模型/强度或沿用默认 |
| 历史列表 | 展示本机已保存的 Agent 会话（标题、更新时间、消息条数可选） |
| 切换 | 点击历史项加载完整消息到面板；当前未保存草稿先自动存盘 |
| 删除 | 列表项删除（确认）；删当前则自动新会话 |
| 重命名 | 可选 V1：双击标题或菜单「重命名」；默认标题 = 首条用户消息截断（约 32 字）或「新会话」 |
| 持久化 | 本地 `agent-sessions/` 或单文件 `agent-sessions.json`；**不含** API Key |
| 与终端上下文 | 切换会话 **不** 切换终端布局；每次发送仍按设置注入当前窗格 ContextBundle |
| 上限 | 建议保留最近 100 条会话或总大小上限（如 20MB），超出淘汰最旧 |

**UI 布局（在原型 Agent 面板上增强，样式跟 token，不引入第二套设计）：**

```
┌─ Agent ──────────────── 焦点 · 窗格 #1 ─┐
│ [历史] [+ 新会话]     或 标题行右侧操作   │
│ 当前标题：解释 git 报错…          ▾     │
│ ─ 消息流 ─                               │
│ …                                        │
│ 建议 chip / 输入 / 模型菜单 / 发送        │
└──────────────────────────────────────────┘
```

- **历史**：打开浮层或侧滑列表（深色卡片，对齐 `.ai-model-menu` 质感）
- **+ 新会话**：立即切换到空白线程；若当前会话无任何消息可静默复用 id（避免空会话刷屏）
- 列表排序：`updatedAt` 降序
- 空状态：历史为空时文案「暂无历史会话」

**数据模型：**

```ts
type AgentChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string          // 展示用纯文本或结构化；assistant 可含建议命令元数据
  createdAt: string
  modelId?: string
  effortId?: string
  // 可选：关联的 insert/run 命令快照
  suggestedCmd?: string
  targetPaneSerial?: number
}

type AgentChatSession = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  modelId?: string
  effortId?: string
  messages: AgentChatMessage[]
}
```

**行为细则：**

1. 发送用户消息 → append 到 `activeSession.messages` → 调 `agent_chat`（带 sessionId 便于日志）→ 流式 append assistant。
2. 任意消息变更 → debounce 写盘（300–500ms）。
3. 应用重启 → 恢复 **上次 activeSessionId** 与消息；历史列表可继续打开。
4. 「重置为默认设置」（模型菜单内）**只重置模型/强度**，不删除会话。
5. 设置「恢复默认」可提供「同时清空 Agent 历史」勾选，默认不勾选。

#### 4.6.7 分屏窗格序号精准控制（V1 必做）

> Agent **必须**能按分屏窗格序号 `#N` 精准定位，完成读上下文、仅插入、插入并运行。
> 序号即 pane-header / 状态栏上的 **#1、#2、#3…**，与原型 `serial` 一致。

##### 寻址主键

| 概念 | 说明 |
|------|------|
| `serial` / `#N` | 用户与模型使用的稳定编号（展示层） |
| `paneId` | 内部 id（`pane-12`），执行层解析用 |
| 映射 | `resolvePane(serial) → leaf \| null`；在 **当前标签** 优先，若 scope=allTabs 则全标签唯一 serial（serial 全局递增故全局唯一） |

因 serial **关闭不复用且全局递增**，`#3` 在应用生命周期内指向同一逻辑窗格身份直至该 leaf 被关闭；关闭后 `#3` 解析失败并明确报错。

##### 用户 / 模型如何指定目标

| 输入 | 目标窗格 |
|------|----------|
| 文案含 `#2`、`窗格 2`、`pane 2` | serial=2 |
| 文案无序号 | **焦点窗格** `focusSerial` |
| 同时多个 `#1 … #3` | 读：可多窗格；写：需模型结构化标出每条命令的 `targetSerial`，或默认最后提到的序号 |
| 按钮「插入并运行 / 仅插入」 | 使用该条 assistant 消息绑定的 `targetPaneSerial`；若无则焦点窗格 |

##### 系统提示中的强制约定（注入模型）

每次 `agent_chat` 的 system/context 必须包含类似说明：

```text
工作台分屏窗格用整数序号标识，显示为 #1、#2、…。
当前布局：{layoutSummary}
窗格索引：#1 ps C:\dev | #2 bash ~/proj | #3 ps …
焦点窗格：#1
当你建议命令时，必须标明目标窗格序号。
结构化输出（推荐）每条命令带 target_serial 字段。
用户说「在 #2 执行」时，命令只能进入 #2，不得写入焦点窗格（除非焦点就是 #2）。
```

##### 结构化动作（推荐，保证「精准」）

助手回复除自然语言外，尽量带机器可读动作（解析优先 JSON / 约定 fence）：

```ts
type AgentPaneAction = {
  type: "insert" | "run" | "insert_and_run"
  targetSerial: number    // 必填：分屏窗格序号
  command: string
  note?: string
}
```

UI 上「插入并运行 / 仅插入」绑定该 `targetSerial`：

1. `resolvePane(targetSerial)`
2. 若不存在 → toast「窗格 #N 不存在或已关闭」+ 列出当前有效序号
3. 若存在 → `setActivePane`（可选，便于用户看到）→ 按写权限写入对应 PTY
4. toast「已在窗格 #N 运行/插入」

##### 读：按序号取上下文

| 场景 | 行为 |
|------|------|
| 用户：「#2 最后报错是什么」 | 以 serial=2 的 scrollback/history 为主回答 |
| 用户：「对比 #1 和 #3 的 git 状态」 | 注入或工具拉取 #1 与 #3 |
| 模型调用 `get_pane(2)` | 返回该 serial 的 PaneContext 全文（受行数上限） |
| 序号不存在 | 明确回复可用列表，如「当前只有 #1、#2」 |

##### 写：按序号执行（与焦点解耦）

```
用户/模型指定 targetSerial
        ↓
resolvePane(serial) ──失败──→ 错误提示 + 有效 # 列表
        ↓ 成功
写权限检查（仅插入 / 确认 / 自动 + 危险）
        ↓
pty_write(paneId) 或 填 draft
        ↓
状态栏/Agent 头可临时显示「目标 · 窗格 #N」
```

**禁止：** 解析到 `#2` 却因焦点在 `#1` 而写入 `#1`。

##### 跨标签

- serial 全局唯一时，`#5` 可能在非当前标签：V1 **允许** 解析成功后自动 `激活该标签 + 该窗格` 再执行，并 toast「已切换到标签 X · 窗格 #5」
- 若产品希望限制仅当前标签：设置项「Agent 仅操作当前标签窗格」默认开；开时跨标签 serial 报错提示先切换标签

##### UI 辅助（提升可点选精度，样式跟 token）

| 辅助 | 说明 |
|------|------|
| Agent 头焦点标签 | 始终显示「焦点 · 窗格 #N」，点击可复制 `#N` |
| 建议动作条 | 「在 #2 运行」按钮文案带序号 |
| （可选）发送前目标 | 输入框旁小选择器「目标: 焦点 / #1 / #2…」覆盖默认；不选则按话术解析 |

##### 验收标准（序号控制）

- [ ] 三窗格布局下，「在 #2 执行 `pwd`」只出现在 #2 的 PTY，#1/#3 不变
- [ ] 「仅插入」到 #3 时，#3 draft 有内容，焦点可仍在 #1
- [ ] 关闭 #2 后再说「在 #2 运行」→ 明确失败并列出当前 #
- [ ] 无序号时默认焦点窗格
- [ ] ContextBundle 含 layoutSummary 与完整 paneIndex
- [ ] 消息上的「插入并运行」使用消息绑定的 targetSerial，而非事后焦点

### 4.7 状态栏

| 字段 | 来源 |
|------|------|
| 已连接本机 Shell | PTY 存活 |
| Shell 名 | 焦点 pane |
| cwd | 焦点 pane |
| 窗口状态 | 最大化/窗口化（系统） |
| 窗格数 | `N 窗格` / `N 窗格 · 树状分屏` |
| 焦点 #N | serial |
| UTF-8 | 固定或设置 |
| Ln, Col | xterm buffer 光标（尽力） |

### 4.8 快捷键（V1 全部生效）

| 操作 | 键 | macOS |
|------|-----|-------|
| 新建标签（开 Shell 菜单） | Ctrl+T | ⌘T |
| 关闭标签 | Ctrl+W | ⌘W |
| 水平分屏 | Alt+Shift+D | 同（Option+Shift+D） |
| 垂直分屏 | Alt+Shift+E | 同 |
| 关闭窗格 | Ctrl+Shift+W | ⌘⇧W |
| Agent 面板 | Ctrl+Shift+A | ⌘⇧A |
| 清屏 | Ctrl+L | ⌘L |
| 设置 | Ctrl+, | ⌘, |
| 联想选择 | ↑↓ Tab Enter Esc | 同 |

与系统冲突时：应用内优先在窗口 focused 时拦截。

### 4.9 设置页交互（原型有的都要）

| 交互 | V1 |
|------|-----|
| 侧栏切换 panel | 同，`aria-current` |
| 搜索过滤分类 | 同，无匹配显示 empty |
| hash / 深链 | 支持 `#ai` 等打开对应 panel |
| 分段控件 segmented | 同 active 切换 |
| switch / range / select | 绑定 store，**真实生效** |
| API Key 显示切换 | 同 |
| 强调色 swatch | 写 CSS 变量即时预览 |
| Shell 配置文件列表 | 扫描渲染 + 添加 + 重扫 |
| 导出 / 保存 / 恢复默认 | 真文件与真重置 |
| 返回工作台 | 路由 `/` |

### 4.10 会话恢复

当「启动时恢复会话」开启：

**恢复：** 标签列表、每标签 layout 树与 ratio、activeTab/Pane、Agent 开合与宽度、窗口 bounds/最大化

**不恢复：** 旧 PTY 进程、完整 scrollback（可选恢复最后 N 行快照，V1 建议：恢复布局后新建 PTY，不强制恢复全文）

### 4.11 初始 seed（开发/演示）

原型启动 seed：PS 标签嵌套分屏 #1|#2/#3 + Bash 标签。

- **开发模式**：可一键加载 seed 便于视觉对比
- **正式用户首次启动**：单标签 + 默认 Shell 单窗格（避免惊吓）；设置「恢复会话」之后沿用用户布局

---

## 5. 设置项完整清单（V1 全部实现且展示）

原则：**界面上出现的控件都必须工作**；不把未做功能摆出来。

### 5.1 常规 `general`

| 选项 | 控件 | 默认 | 生效行为 |
|------|------|------|----------|
| 当前平台 | 只读 | 自动 | `windows` / `macos` / `linux` |
| 默认 Shell | select | 平台相关 | 新标签默认 profile |
| 启动时恢复会话 | switch | 开 | 读 session.json |
| 启动时打开 Agent 面板 | switch | 开 | 控制 aiOpen 初始值 |
| 关闭最后一个标签时 | segmented | 新建会话 | `close` 关窗 / `new` 新建默认 shell 标签 |
| 确认关闭多标签窗口 | switch | 开 | 关窗口前 confirm |
| 复制时包含提示符 | switch | 关 | 复制选区逻辑 |

### 5.2 Shell 配置 `shells`

| 选项 | 控件 | 默认 | 生效行为 |
|------|------|------|----------|
| 配置文件列表 | 卡片 | 扫描 | 启用/路径/默认标记 |
| + 添加配置文件 | button | — | 自定义 name/path/args |
| 重新扫描 | button | — | ShellScanner |
| 工作目录 | text | 主目录 | 新 PTY cwd |
| 启动命令 | text | 空 | 连接后写入一行 |

### 5.3 外观 `appearance`

> 全部只作用于 **呈现层**（工作台铬 + xterm 画布），**不修改**系统 Terminal / 用户全局终端主题。

| 选项 | 控件 | 默认 | 生效行为 |
|------|------|------|----------|
| 强调色 | swatch | 青 195 | `--accent` 等（活动窗格、按钮、ANSI 强调映射） |
| 窗口材质 | segmented | Win:Mica / 他:纯色 | Tauri/WebView 能力内尽力；不支持降级纯色 |
| 字体 | select | Cascadia Code | xterm fontFamily（我方画布） |
| 字号 | range 11–20 | 13 | xterm fontSize |
| 光标样式 | segmented | 竖线 | xterm cursorStyle |
| 光标闪烁 | switch | 开 | cursorBlink |

### 5.4 Agent `ai`

| 选项 | 控件 | 默认 | 生效行为 |
|------|------|------|----------|
| 启用 Agent | switch | 开 | 隐藏侧栏与快捷键 |
| 模型提供方 | select | OpenAI 兼容 | 决定 list/chat 路径适配（OpenAI 兼容 / Anthropic / 自定义） |
| API 端点 | text | 空 | **list models + chat 的 base URL**（必填才可拉列表） |
| API Key | password | 空 | 安全存储；拉列表与对话共用 |
| 刷新模型列表 | button | — | 立即请求 endpoint，更新缓存；展示成功/失败 |
| 模型列表状态 | 只读 | — | 如「已加载 12 个 · 刚刚」/ 错误信息 |
| 默认模型 ID | text | 空 | 手动指定；列表失败时的 fallback；有列表时作默认选中偏好 |
| 上下文范围 | select | 当前标签全部 | focus / activeTab / allTabs |
| 包含未发送输入 | switch | 开 | draft 注入 |
| 附带终端输出 | range | 80 | 行数截断 |
| 运行前确认危险命令 | switch | 开 | 拦截 |
| 命令执行方式 | select | 确认后运行 | 仅插入 / 确认后运行 / 自动运行 |
| Agent 仅操作当前标签窗格 | switch | 开 | 开：#N 仅解析当前标签；关：允许跳转其它标签的 #N |
| 启动时恢复 Agent 会话 | switch | 开 | 恢复上次对话线程；关则每次启动新会话 |
| 清空全部 Agent 历史 | button | — | 二次确认后删除本地会话文件 |

**说明文案（设置页）：**

- 工作台模型下拉中的选项来自上方端点返回的模型列表，请先填写可访问的 API 端点与 Key 并刷新。
- 分屏窗格以 **#序号** 标识（窗格标题栏可见）；Agent 可按序号读取或执行命令，例如「在 #2 运行 git status」。

### 5.5 命令联想 `completion`（V1 新增分类）

| 选项 | 控件 | 默认 | 生效行为 |
|------|------|------|----------|
| 启用命令联想 | switch | 开 | 总开关 |
| 使用历史命令 | switch | 开 | |
| 使用常用命令 | switch | 开 | |
| 模糊匹配 | switch | 关 | |
| 最大建议数 | range | 8 | 3–15 |
| 历史保存条数 | number | 5000 | |
| 按 Shell 分桶 | switch | 开 | |
| 接受建议后 | segmented | 仅填入 | 仅填入 / 填入并执行 |
| 清除历史 | button | — | 确认后清空 |

侧栏分组：应用（常规/Shell/外观）· 智能（Agent）· 输入（命令联想）· 系统（快捷键/关于）。

### 5.6 快捷键 `shortcuts`

- 只读表格，内容同 §4.8
- 说明 macOS ⌘ 映射

### 5.7 关于 `about`

- 名称、版本
- 架构文案（固定）：**外壳 UI（我方设计）→ 终端画布（xterm）→ PTY → 本机 Shell 内核**
- 说明一句：Shell 仅作执行内核，界面与终端样式不使用系统终端外观
- 支持 Shell 列表
- 恢复默认设置
- 打开工作台
- 页脚：导出配置（不含 Key）、保存（若采用显式保存；推荐改即存 + toast）

### 5.8 持久化位置

| 数据 | 存储 |
|------|------|
| settings | `settings.json`（含 endpoint、selectedModelId、models 缓存元数据） |
| secrets | OS keyring / 加密文件 |
| command history | `command-history.json`（终端命令联想） |
| terminal session | `session.json`（标签/分屏布局） |
| agent chat sessions | `agent-sessions.json` 或目录分文件（对话线程，**非**终端布局） |
| models cache | 可选 `models-cache.json`（上次 list 结果） |
| 导出 | 用户指定路径 JSON |

---

## 6. 架构与 IPC

```
┌─────────────── React（1:1 DOM + xterm + 联想层）───────────────┐
│  layout 状态机 · settings store · agent UI · suggest UI         │
└───────────────────────────┬────────────────────────────────────┘
                            │ invoke / events
┌───────────────────────────▼──────── Rust / Tauri ──────────────┐
│ PtyHost │ ShellScanner │ HistoryStore │ Settings │ Session     │
│ AgentProxy（models.list + 流式 chat）│ AgentSessionStore          │
│ SecretStore │ Window hooks                                         │
└────────────────────────────────────────────────────────────────┘
```

### 6.1 主要命令（示意）

| 命令 | 方向 | 说明 |
|------|------|------|
| `pty_create` | F→R | profile + cwd |
| `pty_write` | F→R | 字节/文本 |
| `pty_resize` | F→R | cols, rows |
| `pty_close` | F→R | |
| `pty_data` | R→F | **批量** chunk |
| `pty_exit` | R→F | |
| `history_query` | F→R | 命令联想：prefix, shell, limit |
| `history_record` | F→R | |
| `history_clear` | F→R | |
| `settings_get/set` | F→R | |
| `session_get/set` | F→R | 终端布局会话 |
| `shell_scan` | F→R | |
| `agent_models_list` | F→R | 用设置中 endpoint+key 拉模型；可 forceRefresh |
| `agent_chat` | F→R | stream；参数含 sessionId, modelId, effort, messages, context（含 paneIndex） |
| `agent_abort` | F→R | 可选 |
| `pane_resolve` | F→R 或纯前端 | serial → paneId；供调试 |
| `pty_write_to` | F→R | **按 paneId/serial** 写入；Agent 插入/运行必须走此路径而非「当前焦点」隐式写入 |
| `agent_sessions_list` | F→R | 历史会话摘要列表 |
| `agent_sessions_get` | F→R | 单会话全文 |
| `agent_sessions_save` | F→R | 创建/更新 |
| `agent_sessions_delete` | F→R | 删除 |
| `secrets_set/get` | F→R | |

**性能铁律：** 终端输出不进 React 逐行 state；联想与 Agent 从环形缓冲/历史库取。

---

## 7. V1 开发顺序（全部做完，阶段仅表示施工顺序）

> 阶段是 **工程切片**，不是「V1 只做前两阶段」。
> **全部阶段完成 = V1 发布。**

### Phase A — 工程与视觉冻结

1. 初始化 `apps/desktop`（Tauri 2 + Vite + React + TS）
2. 抽出 `tokens.css` / `workbench.css` / `settings.css`
3. 无边框窗口 + 标题栏拖拽区
4. 静态 Workbench + Settings 壳，seed 对齐原型
5. 黄金截图 diff，修 CSS 直到 1:1

**出口：** 纯静态即可通过视觉验收。

### Phase B — 交互状态机（仍可假终端）

1. 移植 layout 树与 gutter
2. 标签 + Shell 菜单 + toast + 状态栏文案
3. Agent 面板开合/拖宽/模型菜单 UI
4. 设置侧栏切换、搜索、表单绑定内存 store
5. 快捷键
6. 路由 Workbench ↔ Settings

**出口：** 不插电时交互与 HTML 一致（终端可暂用 **同皮肤** 的 textarea/假输出点通交互；禁止用系统终端窗口代替）。

### Phase C — 真内核 + 我方终端画布

1. Rust PTY 多会话（**无界面**子进程，Windows 隐藏 console）
2. xterm 接入；`theme` / 字体严格对接 tokens 与外观设置
3. resize / 中断 / 清屏 / 复制粘贴
4. Shell 扫描与 profile、cwd、启动命令
5. 去掉假 run；验收截图须像 prototype 终端区而非系统 PS 窗口

**出口：** 真实 shell 执行 + 自研外观一体可用。

### Phase D — 历史与联想

1. 持久化历史 + 频次
2. 浮层 UI（token 一致）
3. 设置 `completion` 全部生效

**出口：** 输入联想完整。

### Phase E — Agent 真链路

1. ContextBundle 全窗格只读 + **paneIndex / layoutSummary**
2. 设置 endpoint + Key；**`agent_models_list` 动态填充模型菜单**
3. 提供方流式 chat（当前选中 modelId）
4. **#N 窗格解析 + `pty_write_to(serial)` 精准插入/运行**（§4.6.7）
5. **Agent 新会话 + 历史列表 + 本地持久化**
6. 仅插入 / 确认运行 / 自动运行 + 危险确认
7. 建议 chip；动作按钮带 targetSerial
8. Key 安全存储

**出口：** 模型来自 endpoint；会话可管理；**按 #N 精准控窗格**；读全开、写按策略。

### Phase F — 持久化、打磨、打包

1. settings / session 恢复
2. 导出/恢复默认
3. 多标签关闭确认、最后标签策略
4. 窗口材质尽力、无障碍 focus、reduced-motion
5. 安装包、版本号、关于页
6. 全量验收清单打勾

**出口：V1 发布。**

---

## 8. 测试与验收清单（V1）

### 8.1 视觉

- [ ] 工作台 1366 / 1440 / 1920 与原型叠图通过
- [ ] 设置页同上
- [ ] 标题栏 32 / 标签 38 / 状态 24
- [ ] AI 面板默认 360，可拖 280–520

### 8.2 工作台交互

- [ ] 新建/切换/关闭标签（最后标签策略正确）
- [ ] Shell 菜单四类 + 条件 WSL
- [ ] 分屏 h/v、上限 6、关闭折叠
- [ ] gutter 拖动稳定
- [ ] 焦点窗格与状态栏、Agent 焦点文案同步
- [ ] 快捷键全表
- [ ] 清屏、toast

### 8.3 终端（内核真 · 外观自研）

- [ ] pwsh/bash/zsh/cmd（及 WSL 若有）**真实执行**
- [ ] 终端区域视觉对齐 prototype（配色/字体/窗格头），**不是**系统终端默认皮肤
- [ ] 使用过程中 **无** 额外系统 console/Terminal 窗口抢焦点
- [ ] 中文与 UTF-8
- [ ] 长时间刷屏不卡死 UI
- [ ] resize 后行列正确
- [ ] 切换 Shell 只换内核，工作台铬与 xterm 主题框架保持一致

### 8.4 联想

- [ ] 历史记录与重启后仍在
- [ ] 前缀建议、开关与清除

### 8.5 Agent

- [ ] 能基于 #2 输出/历史/draft 回答
- [ ] **「在 #2 执行」只影响 #2**，不误写入焦点窗格（§4.6.7 验收条全过）
- [ ] 动作按钮携带 `targetSerial`；序号失效时有明确错误
- [ ] **模型菜单项来自设置 endpoint 的 list**，非写死四模型；刷新/失败/fallback 行为正确
- [ ] **新会话**清空消息；**历史列表**可切换/删除；重启后可恢复
- [ ] 仅插入 / 确认运行 / 危险拦截
- [ ] 流式显示；Key 不明文导出；会话文件不含 Key

### 8.6 设置

- [ ] §5 全部选项改后重启仍正确
- [ ] 扫描 Shell、导出、恢复默认

### 8.7 非功能

- [ ] 冷启动可接受；包体明显小于 Electron 同功能预期
- [ ] 无 API Key 写入日志

---

## 9. 风险与对策

| 风险 | 对策 |
|------|------|
| 1:1 被「顺手重构 CSS」破坏 | CSS 原样文件 + 截图门禁；重构放到 V1 后 |
| ConPTY/编码问题 | Windows 优先测；设置中可示意编码 |
| WebView2 缺失 | 安装说明或 bootstrapper |
| Agent 耗 token / 泄密 | 行数截断说明；Key 安全存储；文案告知全量读 |
| 自动运行误操作 | 默认「确认后运行」+ 危险确认开 |
| 范围失控 | §0 非目标冻结；新需求进 V1.1 |

---

## 10. 文档与真源优先级

| 优先级 | 来源 |
|--------|------|
| 1 | `prototype/*.html` 的 CSS、DOM、脚本行为 |
| 2 | 本文 `docs/DEVELOPMENT-PLAN.md` |
| 3 | 实现代码 |

冲突时：**先改代码对齐原型**；若产品故意不同于原型（系统窗口、真 PTY、联想、Agent 读全开），以本文 §0 / §2.4 / §4 增强条款为准，并在 PR 说明。

---

## 11. 下一步行动

1. **评审本文** — 确认 V1 范围与 1:1 策略
2. **脚手架** — `apps/desktop` Tauri + React
3. **Phase A** — CSS 搬迁 + 静态 1:1
4. 按 B→F 顺序一次做完，全部勾选 §8 后发 V1

---

## 附录 A — 原型状态字段对照

```ts
// 工作台（对齐 prototype state）
{
  tabs: Tab[]
  activeTabId: string | null
  nextId: number
  nextPaneSerial: number
  activePaneId: string | null
  aiOpen: boolean
  aiWidth: number
  aiModel: string
  aiEffort: "low" | "medium" | "high" | "max"
  // win 在客户端改为系统窗口状态，不再用 minimized/closed 假状态
}
```

## 附录 B — 默认 Agent 建议 Chip（原型文案）

1. 解释最后一条命令做了什么 → prompt「解释最后一条命令做了什么」
2. 列出本机正在监听的端口
3. 把当前目录文件按大小排序

V1 保留文案与发送行为；后端用真上下文生成回答。
|
