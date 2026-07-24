# Shell Workbench

跨平台终端工作台（Tauri 2 + React + TypeScript + xterm + Rust PTY）。

- 视觉真源：`../../prototype/`
- 开发方案：`../../docs/DEVELOPMENT-PLAN.md`

## 开发

```bash
cd apps/desktop
npm install
npm run tauri:dev
```

仅前端（浏览器，模拟终端）：

```bash
npm run dev
```

## 构建

```bash
npm run tauri:build
```

## 架构

外壳 UI（我方设计）→ xterm 画布 → PTY → 本机 Shell 内核
