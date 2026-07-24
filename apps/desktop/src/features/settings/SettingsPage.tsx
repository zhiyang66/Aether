import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { WinControls } from "../../components/WinControls";
import { Toast } from "../../components/Toast";
import { useSettingsStore, platformLabel } from "../../store/settingsStore";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useShellCatalogStore } from "../../store/shellCatalogStore";
import { clearHistory } from "../../lib/commandHistory";
import { isTauri, winToggleMaximize } from "../../lib/window";
import { THEME_PRESETS } from "../../lib/themes";
import { WorkspacePanel } from "./WorkspacePanel";
import { ExtensionsPanel } from "./ExtensionsPanel";
import { checkForUpdate } from "../../lib/updateCheck";
import logoUrl from "../../assets/logo.png";
import "../../styles/settings.css";
import "../../styles/product.css";

type PanelId =
  | "general"
  | "shells"
  | "appearance"
  | "workspaces"
  | "ai"
  | "extensions"
  | "completion"
  | "shortcuts"
  | "about";

const NAV: { id: PanelId; label: string; group: string }[] = [
  { id: "general", label: "常规", group: "应用" },
  { id: "shells", label: "Shell 配置", group: "应用" },
  { id: "appearance", label: "外观", group: "应用" },
  { id: "workspaces", label: "工作区", group: "应用" },
  { id: "ai", label: "Agent", group: "智能" },
  { id: "extensions", label: "扩展", group: "智能" },
  { id: "completion", label: "命令联想", group: "输入" },
  { id: "shortcuts", label: "快捷键", group: "系统" },
  { id: "about", label: "关于", group: "系统" },
];

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

  const filtered = NAV.filter(
    (n) =>
      !search.trim() ||
      n.label.includes(search) ||
      n.group.includes(search),
  );

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

  return (
    <div className={`app${maximized ? " maximized" : " windowed"}`} id="app">
      <header
        className="titlebar"
        data-tauri-drag-region
        onDoubleClick={async (e) => {
          if ((e.target as HTMLElement).closest(".win-btn, a, button")) return;
          const next = await winToggleMaximize();
          if (typeof next === "boolean") setMaximized(next);
          else setMaximized(!maximized);
        }}
      >
        <div className="titlebar-left" data-tauri-drag-region>
          <div className="app-icon" aria-hidden="true">
            <img src={logoUrl} alt="" draggable={false} />
          </div>
          <div className="app-title">
            <strong>Aether</strong> · 设置
          </div>
        </div>
        <div className="titlebar-nav">
          <Link className="nav-link primary" to="/">
            返回工作台
          </Link>
        </div>
        <WinControls />
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
              placeholder="搜索设置…"
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
              没有匹配的设置分类
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
                  <Row label="复制时包含提示符" desc="选中终端文本是否带 prompt">
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

          {panel === "extensions" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>扩展</h1>
                <p>本地 JSON 扩展：命令面板项与 Agent 提示片段。</p>
              </div>
              <ExtensionsPanel />
            </section>
          )}

          {panel === "ai" && (
            <section className="panel active">
              <div className="panel-header">
                <h1>Agent</h1>
                <p>
                  可读全部窗格输出 / 历史 / 输入；按 #N 精准控制分屏。模型列表来自下方
                  API 端点。任务：对话输入 <code>/task 标题</code> 并换行写步骤。
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
                      <option value="custom">自定义（仍按 OpenAI /v1 协议）</option>
                      {/* anthropic 协议尚未接入请求体，暂不提供以免误导 */}
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
                          if (confirm("确定清除全部命令历史？")) {
                            clearHistory();
                            toastMsg("命令历史已清除");
                          }
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
                        ["中断 / 复制", "Ctrl+C", "终端：有选区复制，否则 SIGINT"],
                        ["强制复制", "Ctrl+Shift+C", "终端：复制选区"],
                        ["粘贴", "Ctrl+V", "终端：粘贴到 PTY"],
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
                      <div className="about-ver">v0.6.0 · Aether</div>
                    </div>
                  </div>
                  <dl className="about-meta">
                    <dt>架构</dt>
                    <dd>外壳 UI（我方设计）→ 终端画布 → PTY → 本机 Shell 内核</dd>
                    <dt>支持 Shell</dt>
                    <dd>PowerShell · bash · zsh · cmd · WSL</dd>
                    <dt>Agent</dt>
                    <dd>按窗格 #序号 · 任务面板 · 扩展 · 会话历史</dd>
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
                            current: "0.6.0",
                            feedUrl: s.updateFeedUrl,
                          });
                          if (r.status === "disabled") toastMsg("未配置更新源");
                          else if (r.status === "up-to-date") toastMsg(`已是最新 · ${r.current}`);
                          else if (r.status === "available") {
                            const go = confirm(
                              `发现新版本 ${r.remote.version}\n\n${r.remote.notes || ""}\n\n打开下载页？`,
                            );
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
                      if (confirm("恢复全部默认设置？")) {
                        s.reset();
                        toastMsg("已恢复默认设置");
                      }
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
              const data = localStorage.getItem("sw-settings-v1") || "{}";
              const blob = new Blob([data], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "shell-workbench-settings.json";
              a.click();
              toastMsg("已导出设置（不含密钥字段请自查）");
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
