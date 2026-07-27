import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { WinControls } from "../../components/WinControls";
import { Toast } from "../../components/Toast";
import { useSettingsStore, platformLabel, exportSettingsJson } from "../../store/settingsStore";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useShellCatalogStore } from "../../store/shellCatalogStore";
import { clearHistory } from "../../lib/commandHistory";
import { isTauri, winToggleMaximize } from "../../lib/window";
import { resolveWindowControlsSide } from "../../lib/platform";
import { THEME_PRESETS } from "../../lib/themes";
import { WorkspacePanel } from "./WorkspacePanel";
import { SnippetsPanel } from "./SnippetsPanel";
import { ApprovalPanel } from "./ApprovalPanel";
import { McpPanel } from "./McpPanel";
import { HostsPanel } from "./HostsPanel";
import { SkillsPanel } from "./SkillsPanel";
import { checkForUpdate } from "../../lib/updateCheck";
import { askConfirm } from "../../components/AppDialog";
import logoUrl from "../../assets/logo.png";
import "../../styles/settings.css";
import "../../styles/product.css";

/** Build-time version from package.json; fallback for test runners without the define. */
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";

type PanelId =
  | "general"
  | "shells"
  | "hosts"
  | "appearance"
  | "workspaces"
  | "ai"
  | "approval"
  | "mcp"
  | "skills"
  | "completion"
  | "snippets"
  | "shortcuts"
  | "about";

type NavItem = {
  id: PanelId;
  label: string;
  group: string;
  /** Extra searchable terms (settings rows, aliases, English). */
  keywords: string[];
};

const NAV: NavItem[] = [
  {
    id: "general",
    label: "常规",
    group: "应用",
    keywords: [
      "启动",
      "默认 shell",
      "恢复会话",
      "打开 agent",
      "关闭标签",
      "多标签",
      "确认关闭",
      "复制命令块",
      "平台",
      "行为",
      "general",
      "startup",
      "restore",
    ],
  },
  {
    id: "shells",
    label: "Shell 配置",
    group: "应用",
    keywords: [
      "工作目录",
      "cwd",
      "启动命令",
      "shell 集成",
      "命令块",
      "osc",
      "长命令",
      "通知",
      "阈值",
      "pwsh",
      "powershell",
      "bash",
      "zsh",
      "cmd",
      "wsl",
      "扫描",
      "shells",
      "profile",
    ],
  },
  {
    id: "hosts",
    label: "SSH 主机",
    group: "应用",
    keywords: [
      "ssh",
      "远程",
      "主机",
      "私钥",
      "跳板",
      "port",
      "端口",
      "user",
      "identity",
      "config",
      "~/.ssh",
      "hosts",
    ],
  },
  {
    id: "appearance",
    label: "外观",
    group: "应用",
    keywords: [
      "主题",
      "预设",
      "不透明度",
      "透明度",
      "opacity",
      "窗口按钮",
      "红绿灯",
      "左侧",
      "右侧",
      "mac",
      "windows",
      "字体",
      "字号",
      "光标",
      "闪烁",
      "终端渲染",
      "gpu",
      "webgl",
      "canvas",
      "渲染",
      "theme",
      "font",
      "appearance",
      "accent",
    ],
  },
  {
    id: "workspaces",
    label: "工作区",
    group: "应用",
    keywords: ["布局", "项目", "切换", "保存工作区", "workspace", "layout"],
  },
  {
    id: "ai",
    label: "Agent",
    group: "智能",
    keywords: [
      "api",
      "endpoint",
      "端点",
      "key",
      "密钥",
      "模型",
      "model",
      "openai",
      "anthropic",
      "上下文",
      "context",
      "危险命令",
      "执行方式",
      "当前标签",
      "会话",
      "快照",
      "aether.md",
      "项目上下文",
      "ai",
      "agent",
      "llm",
    ],
  },
  {
    id: "approval",
    label: "审批",
    group: "智能",
    keywords: [
      "允许",
      "拒绝",
      "规则",
      "保守",
      "平衡",
      "放手",
      "工具",
      "approval",
      "permission",
      "confirm",
    ],
  },
  {
    id: "mcp",
    label: "MCP",
    group: "智能",
    keywords: [
      "model context protocol",
      "stdio",
      "http",
      "server",
      "工具",
      "mcp",
      "连接",
    ],
  },
  {
    id: "skills",
    label: "Skill",
    group: "智能",
    keywords: ["技能", "skill", "~/.aether/skills", "skill.md", "能力"],
  },
  {
    id: "completion",
    label: "命令联想",
    group: "输入",
    keywords: [
      "建议",
      "历史",
      "常用",
      "模糊",
      "匹配",
      "suggest",
      "completion",
      "history",
      "autocomplete",
      "容量",
      "分桶",
    ],
  },
  {
    id: "snippets",
    label: "命令片段",
    group: "输入",
    keywords: ["snippet", "模板", "参数", "片段", "快捷命令", "snippet"],
  },
  {
    id: "shortcuts",
    label: "快捷键",
    group: "系统",
    keywords: [
      "快捷键",
      "键盘",
      "ctrl",
      "cmd",
      "快捷",
      "shortcut",
      "hotkey",
      "keymap",
      "面板",
      "分屏",
      "清屏",
      "粘贴",
      "复制",
    ],
  },
  {
    id: "about",
    label: "关于",
    group: "系统",
    keywords: [
      "版本",
      "更新",
      "version",
      "update",
      "检查更新",
      "about",
      "release",
      "许可证",
      "mit",
    ],
  },
];

function normSearch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True if every query token is found in the haystack (substring, case-insensitive). */
function matchTokens(haystack: string, query: string): boolean {
  const q = normSearch(query);
  if (!q) return true;
  const h = haystack.toLowerCase();
  return q.split(/\s+/).every((tok) => h.includes(tok));
}

export function SettingsPage() {
  const nav = useNavigate();
  const s = useSettingsStore();
  const toastMsg = useWorkbenchStore((st) => st.toastMsg);
  const setAiModels = useWorkbenchStore((st) => st.setAiModels);
  const setAiModel = useWorkbenchStore((st) => st.setAiModel);
  const aiModels = useWorkbenchStore((st) => st.aiModels);
  const aiModel = useWorkbenchStore((st) => st.aiModel);
  const aiModelsStatus = useWorkbenchStore((st) => st.aiModelsStatus);
  const maximized = useWorkbenchStore((st) => st.windowMaximized);
  const setMaximized = useWorkbenchStore((st) => st.setWindowMaximized);
  const shellProfiles = useShellCatalogStore((st) => st.profiles);
  const shellLoading = useShellCatalogStore((st) => st.loading);
  const scanShells = useShellCatalogStore((st) => st.scan);
  const ensureShells = useShellCatalogStore((st) => st.ensureScanned);
  const [panel, setPanel] = useState<PanelId>("general");
  const [search, setSearch] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    s.load();
    const hash = window.location.hash.replace("#", "") as PanelId;
    if (NAV.some((n) => n.id === hash)) setPanel(hash);
    void ensureShells();
  }, []);

  const filtered = NAV.filter((n) => {
    if (!search.trim()) return true;
    const blob = [n.id, n.label, n.group, ...n.keywords].join(" ");
    return matchTokens(blob, search);
  });

  // When search yields a single category, jump there so the panel matches the hit.
  useEffect(() => {
    if (!search.trim()) return;
    if (filtered.length === 1 && filtered[0].id !== panel) {
      setPanel(filtered[0].id);
      window.location.hash = filtered[0].id;
    }
  }, [search, filtered, panel]);

  const refreshModels = async () => {
    const endpoint = s.aiEndpoint.trim().replace(/\/$/, "");
    if (!endpoint) {
      setAiModels([], "请填写 API 端点");
      toastMsg("请填写 API 端点");
      return;
    }
    if (!s.aiApiKey.trim()) {
      setAiModels([], "请填写 API Key");
      toastMsg("请填写 API Key");
      return;
    }
    setModelsLoading(true);
    setAiModels(aiModels, "加载中…");
    try {
      const { agentModelsList } = await import("../../ipc/pty");
      const models = await agentModelsList(endpoint, s.aiApiKey, s.aiProvider);
      setAiModels(models, `已加载 ${models.length} 个 · ${new Date().toLocaleTimeString()}`);
      // Prefer existing selection if still valid; else first model
      const keep =
        models.find((m) => m.id === s.aiDefaultModelId) ||
        models.find((m) => m.id === aiModel) ||
        models[0];
      if (keep) {
        s.patch({ aiDefaultModelId: keep.id });
        setAiModel(keep.id);
      }
      toastMsg(`模型列表已刷新 · ${models.length} 个`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiModels([], `失败：${msg}`);
      toastMsg(`刷新模型失败：${msg}`);
    } finally {
      setModelsLoading(false);
    }
  };

  const side = resolveWindowControlsSide(s.windowControlsSide);
  const leftChrome = side === "left";

  return (
    <div className={`app${maximized ? " maximized" : " windowed"}`} id="app">
      <header
        className={`titlebar${leftChrome ? " is-mac" : " is-win"}`}
        data-tauri-drag-region
        onDoubleClick={async (e) => {
          if ((e.target as HTMLElement).closest(".win-btn, .traffic-btn, a, button")) return;
          const next = await winToggleMaximize();
          if (typeof next === "boolean") setMaximized(next);
          else setMaximized(!maximized);
        }}
      >
        {leftChrome ? (
          <>
            <div className="titlebar-mac-side titlebar-mac-side-left">
              <WinControls side="left" />
              <div className="titlebar-drag-fill" data-tauri-drag-region aria-hidden="true" />
            </div>
            <div className="titlebar-mac-center" data-tauri-drag-region>
              <div className="app-icon" aria-hidden="true">
                <img src={logoUrl} alt="" draggable={false} />
              </div>
              <div className="app-title" data-tauri-drag-region>
                <strong>Aether</strong> · 设置
              </div>
            </div>
            <div className="titlebar-mac-side titlebar-mac-side-right">
              <div className="titlebar-drag-fill" data-tauri-drag-region aria-hidden="true" />
              <div className="titlebar-nav">
                <Link className="nav-link primary" to="/">
                  返回工作台
                </Link>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="titlebar-left" data-tauri-drag-region>
              <div className="app-icon" aria-hidden="true">
                <img src={logoUrl} alt="" draggable={false} />
              </div>
              <div className="app-title" data-tauri-drag-region>
                <strong>Aether</strong> · 设置
              </div>
            </div>
            <div className="titlebar-drag-fill" data-tauri-drag-region aria-hidden="true" />
            <div className="titlebar-nav">
              <Link className="nav-link primary" to="/">
                返回工作台
              </Link>
            </div>
            <WinControls side="right" />
          </>
        )}
      </header>

      <div className="body">
        <aside className="sidebar" aria-label="设置导航">
          <div className="side-search">
            <label className="visually-hidden" htmlFor="side-search">
              搜索设置
            </label>
            <input
              type="search"
              id="side-search"
              placeholder="搜索设置、关键词…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
          {(["应用", "智能", "输入", "系统"] as const).map((group) => {
            const items = filtered.filter((n) => n.group === group);
            if (!items.length) return null;
            return (
              <div key={group}>
                <div className="side-group-label">{group}</div>
                {items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`side-item${panel === n.id ? " active" : ""}`}
                    aria-current={panel === n.id ? "page" : undefined}
                    title={n.keywords.slice(0, 8).join(" · ")}
                    onClick={() => {
                      setPanel(n.id);
                      window.location.hash = n.id;
                    }}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="side-empty" role="status">
              没有匹配项
              <div style={{ marginTop: 6, fontSize: 11, opacity: 0.75 }}>
                可试：字体、GPU、SSH、API、快捷键、审批…
              </div>
            </div>
          )}
        </aside>

        <main className="content">
          {panel === "general" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>常规</h1>
                <p>启动行为、默认 Shell 与会话策略。命令仍由本机 Shell 内核执行。</p>
              </div>
              <div className="section">
                <div className="section-title">启动</div>
                <div className="card">
                  <Row label="当前平台（自动识别）" desc="只读">
                    <div className="platform-readonly">
                      <span className="pr-name">{platformLabel()}</span>
                      <span className="pr-tag">只读</span>
                    </div>
                  </Row>
                  <Row label="默认 Shell" desc="来自本机扫描结果">
                    <select
                      className="ctrl"
                      value={
                        shellProfiles.some((p) => p.shellKey === s.defaultShell)
                          ? s.defaultShell
                          : shellProfiles[0]?.shellKey || s.defaultShell
                      }
                      onChange={(e) => s.patch({ defaultShell: e.target.value })}
                    >
                      {shellProfiles.length === 0 && (
                        <option value={s.defaultShell}>扫描中 / 未检测到</option>
                      )}
                      {shellProfiles.map((p) => (
                        <option key={p.id} value={p.shellKey}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Row>
                  <Row label="启动时恢复会话" desc="恢复标签与分屏布局">
                    <Switch checked={s.restoreSession} onChange={(v) => s.patch({ restoreSession: v })} />
                  </Row>
                  <Row label="启动时打开 Agent 面板" desc="右侧 Agent 默认显示">
                    <Switch checked={s.aiOnStart} onChange={(v) => s.patch({ aiOnStart: v })} />
                  </Row>
                </div>
              </div>
              <div className="section">
                <div className="section-title">行为</div>
                <div className="card">
                  <Row label="关闭最后一个标签时" desc="关闭窗口或新建空白会话">
                    <Segmented
                      value={s.lastTabAction}
                      options={[
                        { val: "close", label: "关闭窗口" },
                        { val: "new", label: "新建会话" },
                      ]}
                      onChange={(v) => s.patch({ lastTabAction: v as "close" | "new" })}
                    />
                  </Row>
                  <Row label="确认关闭多标签窗口" desc="多个会话时弹出确认">
                    <Switch
                      checked={s.confirmMultiTabClose}
                      onChange={(v) => s.patch({ confirmMultiTabClose: v })}
                    />
                  </Row>
                  <Row label="复制命令块输出时包含命令行" desc="点命令块「复制输出」时是否保留首行命令">
                    <Switch checked={s.copyWithPrompt} onChange={(v) => s.patch({ copyWithPrompt: v })} />
                  </Row>
                </div>
              </div>
            </section>
          )}

          {panel === "shells" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>Shell 配置</h1>
                <p>
                  仅显示本机扫描到的 Shell（无内置假列表）。Windows 会枚举 WSL
                  发行版（如 Ubuntu-24.04）。
                </p>
              </div>
              <div className="section">
                <div className="section-title">
                  本机 Shell · {platformLabel()}
                  {shellLoading ? " · 扫描中…" : ` · ${shellProfiles.length} 个`}
                </div>
                <div className="card">
                  {shellProfiles.length === 0 && (
                    <div className="row">
                      <div className="row-text">
                        <div className="row-desc">
                          {isTauri()
                            ? "未检测到可用 Shell，请点击下方重新扫描。"
                            : "浏览器模式无法完整扫描，请使用桌面客户端。"}
                        </div>
                      </div>
                    </div>
                  )}
                  {shellProfiles.map((p) => (
                    <div className="row" key={p.id}>
                      <div className="row-text">
                        <div className="row-label">{p.name}</div>
                        <div className="row-desc" style={{ fontFamily: "var(--font-mono)" }}>
                          {p.desc || p.path}
                          {p.args?.length ? ` ${p.args.join(" ")}` : ""}
                        </div>
                      </div>
                      <div className="row-control">
                        <span className="pr-tag">{p.shellKey}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={shellLoading}
                    onClick={async () => {
                      const list = await scanShells();
                      toastMsg(`扫描完成 · ${list.length} 个 Shell`);
                    }}
                  >
                    {shellLoading ? "扫描中…" : "重新扫描本机 Shell"}
                  </button>
                </div>
              </div>
              <div className="section">
                <div className="section-title">启动参数</div>
                <div className="card">
                  <Row label="工作目录" desc="新会话初始 cwd">
                    <input
                      className="ctrl mono"
                      value={s.cwd}
                      onChange={(e) => s.patch({ cwd: e.target.value })}
                      placeholder="留空则主目录"
                    />
                  </Row>
                  <Row label="启动命令" desc="会话建立后自动执行">
                    <input
                      className="ctrl mono"
                      value={s.startupCmd}
                      onChange={(e) => s.patch({ startupCmd: e.target.value })}
                      placeholder="例如 clear"
                    />
                  </Row>
                </div>
              </div>
              <div className="section">
                <div className="section-title">命令块（Shell 集成）</div>
                <div className="card">
                  <Row
                    label="Shell 集成"
                    desc="注入 OSC 133 标记，启用命令块/退出码/失败标记（支持 pwsh、bash、zsh；新会话生效）"
                  >
                    <Switch
                      checked={s.shellIntegration}
                      onChange={(v) => s.patch({ shellIntegration: v })}
                    />
                  </Row>
                  <Row
                    label="长命令完成通知"
                    desc="窗口未聚焦时，超过阈值的命令结束后发送系统通知"
                  >
                    <Switch
                      checked={s.notifyOnLongCommand}
                      onChange={(v) => s.patch({ notifyOnLongCommand: v })}
                    />
                  </Row>
                  <Row label="通知阈值（秒）" desc="命令运行超过该时长才通知">
                    <input
                      className="ctrl"
                      type="number"
                      min={3}
                      max={600}
                      style={{ width: 90 }}
                      value={s.notifyThresholdSec}
                      onChange={(e) => {
                        const n = Math.min(600, Math.max(3, Number(e.target.value) || 15));
                        s.patch({ notifyThresholdSec: n });
                      }}
                    />
                  </Row>
                </div>
              </div>
            </section>
          )}

          {panel === "hosts" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>SSH 主机</h1>
                <p>
                  以系统 ssh 为内核的远程主机管理：主机即 Shell 配置，
                  在新建标签 / 分屏菜单中一键连接。密钥路径仅存本机。
                </p>
              </div>
              <HostsPanel />
            </section>
          )}

          {panel === "appearance" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>外观</h1>
                <p>
                  主题预设与界面不透明度。不透明度低于 100% 时窗口半透明，可看到下方桌面/其它窗口（非单纯变暗）。
                  拖动可实时预览，点右下角「保存」写入配置。
                </p>
              </div>
              <div className="section">
                <div className="section-title">主题</div>
                <div className="card">
                  <Row label="主题预设" desc="一键套用界面与终端配色">
                    <div className="theme-presets">
                      {THEME_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`theme-preset-btn${s.themePreset === p.id ? " active" : ""}`}
                          onClick={() => s.applyPreset(p.id)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row
                    label="界面不透明度"
                    desc="100% 不透明 · 越低越能透出桌面 · 预览后需点「保存」"
                  >
                    <div className="slider-wrap">
                      <input
                        type="range"
                        min={40}
                        max={100}
                        step={1}
                        value={s.uiOpacity ?? 100}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          // live preview only (patch special-case for uiOpacity)
                          s.patch({ uiOpacity: n });
                        }}
                      />
                      <span className="slider-val">{s.uiOpacity ?? 100}%</span>
                    </div>
                  </Row>
                  <Row
                    label="窗口按钮位置"
                    desc="自动：mac 左侧红绿灯 · 其它右侧 Windows 按钮；也可强制左侧/右侧"
                  >
                    <Segmented
                      value={s.windowControlsSide ?? "auto"}
                      options={[
                        { val: "auto", label: "自动" },
                        { val: "left", label: "左侧 · Mac" },
                        { val: "right", label: "右侧 · Win" },
                      ]}
                      onChange={(v) =>
                        s.patch({
                          windowControlsSide: v as "auto" | "left" | "right",
                        })
                      }
                    />
                  </Row>
                </div>
              </div>
              <div className="section">
                <div className="section-title">终端</div>
                <div className="card">
                  <Row label="字体" desc="等宽字体">
                    <select
                      className="ctrl"
                      value={s.fontFamily}
                      onChange={(e) => s.patch({ fontFamily: e.target.value })}
                    >
                      {["Cascadia Code", "JetBrains Mono", "Consolas", "Sarasa Mono SC"].map(
                        (f) => (
                          <option key={f}>{f}</option>
                        ),
                      )}
                    </select>
                  </Row>
                  <Row label="字号" desc="终端主体">
                    <div className="slider-wrap">
                      <input
                        type="range"
                        min={11}
                        max={20}
                        value={s.fontSize}
                        onChange={(e) => s.patch({ fontSize: Number(e.target.value) })}
                      />
                      <span className="slider-val">{s.fontSize}px</span>
                    </div>
                  </Row>
                  <Row label="光标样式">
                    <Segmented
                      value={s.cursorStyle}
                      options={[
                        { val: "bar", label: "竖线" },
                        { val: "block", label: "方块" },
                        { val: "underline", label: "下划线" },
                      ]}
                      onChange={(v) => s.patch({ cursorStyle: v as typeof s.cursorStyle })}
                    />
                  </Row>
                  <Row label="光标闪烁">
                    <Switch checked={s.cursorBlink} onChange={(v) => s.patch({ cursorBlink: v })} />
                  </Row>
                  <Row
                    label="终端渲染"
                    desc="默认 GPU（WebGL），失败自动回退 Canvas · 切换后新开窗格/标签生效 · 状态栏显示 GPU/Canvas"
                  >
                    <Segmented
                      value={s.termRenderer ?? "auto"}
                      options={[
                        { val: "auto", label: "自动" },
                        { val: "webgl", label: "GPU" },
                        { val: "canvas", label: "Canvas" },
                      ]}
                      onChange={(v) =>
                        s.patch({ termRenderer: v as "auto" | "webgl" | "canvas" })
                      }
                    />
                  </Row>
                </div>
              </div>
            </section>
          )}

          {panel === "workspaces" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>工作区</h1>
                <p>保存并切换整套终端布局与默认目录，便于多项目切换。</p>
              </div>
              <WorkspacePanel />
            </section>
          )}

          {panel === "approval" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>审批</h1>
                <p>
                  Agent 每次使用工具、执行命令、调用 MCP 前都会经过这里的策略：
                  规则优先，其次预设档；「总是允许」写入的规则在此可见、可撤销。
                </p>
              </div>
              <ApprovalPanel />
            </section>
          )}

          {panel === "mcp" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>MCP</h1>
                <p>
                  连接 Model Context Protocol server，把外部工具（文件系统、数据库、
                  浏览器…）开放给 Agent。stdio 为本地进程，http 为远程端点；
                  所有调用都经过「审批」策略。
                </p>
              </div>
              <McpPanel />
            </section>
          )}

          {panel === "skills" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>Skill</h1>
                <p>
                  Agent 的内置能力简报——教它何时/如何操作 Aether 的各项功能，
                  随每次对话自动注入。当前为内置，随发布更新。
                </p>
              </div>
              <SkillsPanel />
            </section>
          )}

          {panel === "ai" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>Agent</h1>
                <p>
                  可读全部窗格输出 / 历史 / 输入；按 #N 精准控制分屏。模型列表来自下方
                  API 端点。直接对话描述需求即可，Agent 会用工具完成。
                </p>
              </div>
              <div className="section">
                <div className="section-title">连接</div>
                <div className="card">
                  <Row label="启用 Agent">
                    <Switch checked={s.aiEnabled} onChange={(v) => s.patch({ aiEnabled: v })} />
                  </Row>
                  <Row label="模型提供方">
                    <select
                      className="ctrl"
                      value={s.aiProvider}
                      onChange={(e) =>
                        s.patch({ aiProvider: e.target.value as typeof s.aiProvider })
                      }
                    >
                      <option value="openai-compat">OpenAI 兼容 API（推荐）</option>
                      <option value="anthropic">Anthropic 原生（/v1/messages）</option>
                      <option value="custom">自定义（仍按 OpenAI /v1 协议）</option>
                    </select>
                  </Row>
                  <Row
                    label="API 端点"
                    desc="OpenAI 兼容 base，须含 /v1。只填域名时客户端会自动补 /v1"
                  >
                    <input
                      className="ctrl mono"
                      value={s.aiEndpoint}
                      onChange={(e) => s.patch({ aiEndpoint: e.target.value })}
                      placeholder="https://api.example.com/v1"
                    />
                  </Row>
                  <Row label="API Key" desc="仅保存在本机">
                    <input
                      className="ctrl mono"
                      type="password"
                      value={s.aiApiKey}
                      onChange={(e) => s.patch({ aiApiKey: e.target.value })}
                      placeholder="sk-…"
                      autoComplete="off"
                    />
                  </Row>
                  <div className="row">
                    <div className="row-text">
                      <div className="row-label">拉取模型</div>
                      <div className="row-desc">
                        {aiModelsStatus || "填写端点与 Key 后点击拉取"}
                        {!isTauri() ? " · 浏览器可能遇 CORS，请用桌面端" : ""}
                      </div>
                    </div>
                    <div className="row-control">
                      <button
                        className="btn primary"
                        type="button"
                        disabled={modelsLoading}
                        onClick={() => void refreshModels()}
                      >
                        {modelsLoading ? "拉取中…" : "拉取模型列表"}
                      </button>
                    </div>
                  </div>
                  <Row label="默认模型" desc="从已拉取列表中选择">
                    <select
                      className="ctrl"
                      value={
                        aiModels.some((m) => m.id === s.aiDefaultModelId)
                          ? s.aiDefaultModelId
                          : aiModels[0]?.id || ""
                      }
                      disabled={aiModels.length === 0}
                      onChange={(e) => {
                        const id = e.target.value;
                        s.patch({ aiDefaultModelId: id });
                        setAiModel(id);
                      }}
                    >
                      {aiModels.length === 0 && (
                        <option value="">请先拉取模型列表</option>
                      )}
                      {aiModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label === m.id ? m.id : `${m.label} (${m.id})`}
                        </option>
                      ))}
                    </select>
                  </Row>
                </div>
              </div>
              <div className="section">
                <div className="section-title">上下文与安全</div>
                <div className="card">
                  <Row
                    label="上下文范围"
                    desc="发送给模型的终端范围 · 越宽费用与隐私面越大"
                  >
                    <select
                      className="ctrl"
                      value={s.contextScope}
                      onChange={(e) =>
                        s.patch({ contextScope: e.target.value as typeof s.contextScope })
                      }
                    >
                      <option value="focus">仅焦点窗格（推荐）</option>
                      <option value="activeTab">当前标签全部窗格</option>
                      <option value="allTabs">所有标签 + 窗格</option>
                    </select>
                  </Row>
                  <Row label="包含未发送输入" desc="窗格草稿行也会进入上下文（已脱敏）">
                    <Switch checked={s.includeDraft} onChange={(v) => s.patch({ includeDraft: v })} />
                  </Row>
                  <Row label="附带终端输出" desc="每窗格行数 · 过长会截断并脱敏密钥">
                    <div className="slider-wrap">
                      <input
                        type="range"
                        min={20}
                        max={120}
                        step={10}
                        value={s.contextLines}
                        onChange={(e) => s.patch({ contextLines: Number(e.target.value) })}
                      />
                      <span className="slider-val">{s.contextLines}</span>
                    </div>
                  </Row>
                  <Row
                    label="项目上下文 AETHER.md"
                    desc="从焦点窗格 cwd 向上查找 AETHER.md 注入请求（8KB 上限，git 根目录截止）"
                  >
                    <Switch
                      checked={s.projectContext}
                      onChange={(v) => s.patch({ projectContext: v })}
                    />
                  </Row>
                  <Row
                    label="危险命令保护"
                    desc="开启后：确认模式下危险命令只插入不执行；自动模式仍会执行但提示"
                  >
                    <Switch checked={s.confirmDanger} onChange={(v) => s.patch({ confirmDanger: v })} />
                  </Row>
                  <Row
                    label="Agent 命令执行方式"
                    desc="仅插入=永不自动回车；确认=危险则只插入；自动=一律执行"
                  >
                    <select
                      className="ctrl"
                      value={s.execMode}
                      onChange={(e) => s.patch({ execMode: e.target.value as typeof s.execMode })}
                    >
                      <option value="insert">仅插入（最安全）</option>
                      <option value="confirm">确认：危险则仅插入</option>
                      <option value="auto">自动运行</option>
                    </select>
                  </Row>
                  <Row
                    label="Agent 仅操作当前标签"
                    desc="开启后 actions 的 #N 不能跨到其它标签"
                  >
                    <Switch
                      checked={s.agentCurrentTabOnly}
                      onChange={(v) => s.patch({ agentCurrentTabOnly: v })}
                    />
                  </Row>
                  <Row label="启动时恢复 Agent 会话">
                    <Switch
                      checked={s.restoreAgentSession}
                      onChange={(v) => s.patch({ restoreAgentSession: v })}
                    />
                  </Row>
                  <Row label="终端输出快照" desc="重启后恢复最近 N 行（可选）">
                    <Switch
                      checked={s.outputSnapshotEnabled}
                      onChange={(v) => s.patch({ outputSnapshotEnabled: v })}
                    />
                  </Row>
                  <Row label="快照行数">
                    <div className="slider-wrap">
                      <input
                        type="range"
                        min={50}
                        max={500}
                        step={50}
                        value={s.outputSnapshotLines}
                        onChange={(e) =>
                          s.patch({ outputSnapshotLines: Number(e.target.value) })
                        }
                      />
                      <span className="slider-val">{s.outputSnapshotLines}</span>
                    </div>
                  </Row>
                </div>
              </div>
            </section>
          )}

          {panel === "completion" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>命令联想</h1>
                <p>历史命令与常用命令输入浮层。</p>
              </div>
              <div className="section">
                <div className="card">
                  <Row label="启用命令联想">
                    <Switch checked={s.suggestEnabled} onChange={(v) => s.patch({ suggestEnabled: v })} />
                  </Row>
                  <Row label="使用历史命令">
                    <Switch checked={s.suggestHistory} onChange={(v) => s.patch({ suggestHistory: v })} />
                  </Row>
                  <Row label="使用常用命令">
                    <Switch checked={s.suggestFrequent} onChange={(v) => s.patch({ suggestFrequent: v })} />
                  </Row>
                  <Row label="模糊匹配">
                    <Switch checked={s.suggestFuzzy} onChange={(v) => s.patch({ suggestFuzzy: v })} />
                  </Row>
                  <Row label="最大建议数">
                    <div className="slider-wrap">
                      <input
                        type="range"
                        min={3}
                        max={15}
                        value={s.suggestMax}
                        onChange={(e) => s.patch({ suggestMax: Number(e.target.value) })}
                      />
                      <span className="slider-val">{s.suggestMax}</span>
                    </div>
                  </Row>
                  <Row label="按 Shell 分桶">
                    <Switch checked={s.historyByShell} onChange={(v) => s.patch({ historyByShell: v })} />
                  </Row>
                  <Row label="历史容量上限" desc="超出后丢弃最旧记录（500–20000）">
                    <input
                      className="ctrl"
                      type="number"
                      min={500}
                      max={20000}
                      step={500}
                      value={s.historyLimit}
                      onChange={(e) => {
                        const n = Math.min(20000, Math.max(500, Number(e.target.value) || 5000));
                        s.patch({ historyLimit: n });
                      }}
                      style={{ width: 96 }}
                    />
                  </Row>
                  <Row label="接受建议后">
                    <Segmented
                      value={s.suggestAccept}
                      options={[
                        { val: "insert", label: "仅填入" },
                        { val: "run", label: "填入并执行" },
                      ]}
                      onChange={(v) => s.patch({ suggestAccept: v as "insert" | "run" })}
                    />
                  </Row>
                  <div className="row">
                    <div className="row-text">
                      <div className="row-label">清除历史</div>
                    </div>
                    <div className="row-control">
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          void askConfirm("清除命令历史", {
                            message: "确定清除全部命令历史？此操作不可撤销。",
                            danger: true,
                            okLabel: "清除",
                          }).then((ok) => {
                            if (ok) {
                              clearHistory();
                              toastMsg("命令历史已清除");
                            }
                          });
                        }}
                      >
                        清除历史…
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {panel === "snippets" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>命令片段</h1>
                <p>
                  可复用命令模板，参数用 {"{name}"} 占位。命令面板（Ctrl+Shift+P）
                  中调用，触发时弹窗填参后插入当前窗格。
                </p>
              </div>
              <SnippetsPanel />
            </section>
          )}

          {panel === "shortcuts" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>快捷键</h1>
                <p>macOS 上将 Ctrl 映射为 ⌘。另支持命令面板 Ctrl+Shift+P。</p>
              </div>
              <div className="section">
                <div className="card">
                  <table className="kbd-table">
                    <thead>
                      <tr>
                        <th>操作</th>
                        <th>快捷键</th>
                        <th>说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["命令面板", "Ctrl+Shift+P", "快速执行工作台命令"],
                        ["新建标签", "Ctrl+T", "打开 Shell 菜单"],
                        ["关闭标签", "Ctrl+W", "关闭当前终端会话"],
                        ["向右分屏", "Alt+Shift+D", "水平拆分焦点窗格"],
                        ["向下分屏", "Alt+Shift+E", "垂直拆分焦点窗格"],
                        ["关闭窗格", "Ctrl+Shift+W", "关闭当前窗格"],
                        ["切换窗格", "Ctrl+Alt+←/→", "焦点在分屏间循环"],
                        ["Agent 面板", "Ctrl+Shift+A", "显示/隐藏"],
                        ["清屏", "Ctrl+L", "清空焦点窗格（终端内亦可）"],
                        ["焦点最大化", "Ctrl+Shift+M", "最大化/还原焦点窗格"],
                        ["中断 / 复制", "Ctrl+C", "终端：有选区复制，否则 SIGINT"],
                        ["强制复制", "Ctrl+Shift+C", "终端：复制选区"],
                        ["复制（备用）", "Ctrl+Insert", "终端：复制选区"],
                        ["粘贴", "Ctrl+V", "终端：粘贴到 PTY"],
                        ["粘贴（备用）", "Shift+Insert", "终端：粘贴到 PTY"],
                        ["打开设置", "Ctrl+,", "本页"],
                      ].map(([a, k, d]) => (
                        <tr key={a}>
                          <td className="action">{a}</td>
                          <td>
                            {k.split("+").map((part, i) => (
                              <span key={part}>
                                {i > 0 ? " + " : ""}
                                <kbd>{part}</kbd>
                              </span>
                            ))}
                          </td>
                          <td className="desc">{d}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {panel === "about" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>关于</h1>
                <p>跨平台终端工作台：多标签、分屏与 Agent 一体。</p>
              </div>
              <div className="section">
                <div className="card">
                  <div className="about-hero">
                    <div className="about-logo" aria-hidden="true">
                      <img src={logoUrl} alt="" draggable={false} />
                    </div>
                    <div>
                      <div className="about-name">Aether</div>
                      <div className="about-ver">v{APP_VERSION} · Aether</div>
                    </div>
                  </div>
                  <dl className="about-meta">
                    <dt>架构</dt>
                    <dd>外壳 UI（我方设计）→ 终端画布 → PTY → 本机 Shell 内核</dd>
                    <dt>支持 Shell</dt>
                    <dd>PowerShell · bash · zsh · cmd · WSL</dd>
                    <dt>Agent</dt>
                    <dd>按窗格 T1:#1 / #序号 · 会话历史 · Actions 按钮</dd>
                    <dt>平台</dt>
                    <dd>Windows · macOS · Linux</dd>
                  </dl>
                </div>
              </div>
              <div className="section">
                <div className="section-title">更新</div>
                <div className="card">
                  <Row label="更新源 URL" desc="version.json 地址，留空则不检查">
                    <input
                      className="ctrl mono"
                      value={s.updateFeedUrl}
                      onChange={(e) => s.patch({ updateFeedUrl: e.target.value })}
                      placeholder="https://example.com/version.json"
                    />
                  </Row>
                  <div className="row">
                    <div className="row-text">
                      <div className="row-label">检查更新</div>
                      <div className="row-desc">仅提示，不自动安装</div>
                    </div>
                    <div className="row-control">
                      <button
                        type="button"
                        className="btn"
                        onClick={async () => {
                          const r = await checkForUpdate({
                            current: APP_VERSION,
                            feedUrl: s.updateFeedUrl,
                          });
                          if (r.status === "disabled") toastMsg("未配置更新源");
                          else if (r.status === "up-to-date") toastMsg(`已是最新 · ${r.current}`);
                          else if (r.status === "available") {
                            const go = await askConfirm(`发现新版本 ${r.remote.version}`, {
                              message: `${r.remote.notes || ""}\n\n打开下载页？`.trim(),
                              okLabel: "打开下载页",
                            });
                            if (go && r.remote.url) window.open(r.remote.url, "_blank");
                            else toastMsg(`可用版本 ${r.remote.version}`);
                          } else toastMsg(`检查失败：${r.message}`);
                        }}
                      >
                        检查更新
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="section">
                <div className="btn-row">
                  <button className="btn primary" type="button" onClick={() => nav("/")}>
                    打开工作台
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      void askConfirm("恢复默认设置", {
                        message: "全部设置将恢复为默认值（API Key 也会被清除）。",
                        danger: true,
                        okLabel: "恢复默认",
                      }).then((ok) => {
                        if (ok) {
                          s.reset();
                          toastMsg("已恢复默认设置");
                        }
                      });
                    }}
                  >
                    恢复默认设置
                  </button>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      <div className="footer-bar">
        <div className="btn-row">
          <button
            className="btn"
            type="button"
            onClick={() => {
              const blob = new Blob([exportSettingsJson()], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "shell-workbench-settings.json";
              a.click();
              toastMsg("已导出设置（已移除密钥字段）");
            }}
          >
            导出配置
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              // Commit opacity + rest of settings to localStorage
              s.save();
              s.applyAccent();
              toastMsg("设置已保存");
            }}
          >
            保存
          </button>
        </div>
      </div>
      <Toast />
    </div>
  );
}

function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="row">
      <div className="row-text">
        <div className="row-label">{label}</div>
        {desc && <div className="row-desc">{desc}</div>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
    </label>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { val: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.val}
          type="button"
          className={value === o.val ? "active" : ""}
          onClick={() => onChange(o.val)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
