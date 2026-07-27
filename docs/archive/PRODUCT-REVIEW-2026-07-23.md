# Shell Workbench · 产品 Review 与成熟度改进（2026-07-23）

## 1. 全局 Review 结论

| 维度 | 评级 | 说明 |
|------|------|------|
| 视觉还原 | B+ | prototype CSS 原样迁入；桌面无边框 + 状态增强 |
| 核心交互 | A- | 标签/分屏/Agent/#N 路径完整 |
| 真终端 | B | Tauri PTY + xterm；浏览器 mock 可用 |
| Agent | B+ | endpoint 模型列表、会话、#N、危险确认 |
| 稳定性 | B | ErrorBoundary、persist 防重复订阅 |
| 产品完成度 | B | 可日常使用；缺安装分发与自动化测试 |

## 2. 本轮已落地的优化（含自增想法）

### 缺陷修复
- 命令历史上/下浏览状态机（`historyNavigate`）
- 持久化订阅只注册一次；尊重「恢复会话 / 恢复 Agent 会话」开关
- 设置 → 真实 `shell_scan` 并展示路径
- Agent 插入/运行：execMode + 危险命令确认
- PTY 输出镜像进 `paneRegistry`，Agent 真能读实时终端内容

### 产品化增强（自增）
1. **命令面板** `Ctrl+Shift+P`：新建标签、分屏、聚焦 #N、设置、主题循环
2. **ErrorBoundary**：崩溃可回工作台
3. **状态栏语义**：MOCK / PTY 徽章、Agent 开闭、命令面板提示
4. **窗格切换** `Ctrl+Alt+←/→`
5. **Agent 当前会话标题** 展示
6. **product.css** 统一增强层样式，不污染 prototype 主 CSS

## 3. 后续建议（未做，可进 V1.1）

- 单元测试：layout 树算法、danger 启发式、parseTargetSerial
- PTY 侧 cwd 解析（OSC 7）回写 pane header
- 命令联想在真 xterm 下的 overlay（当前仅 mock textarea）
- 安装包 CI（tauri build）与代码签名
- Agent 流式 HTML 消毒（DOMPurify）
- 多窗口 / 拖出标签

## 4. 运行

```bash
cd apps/desktop
npm run dev          # 浏览器 mock
npm run tauri:dev    # 真 PTY
```
