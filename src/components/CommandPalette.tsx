import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkbenchStore } from "../store/workbenchStore";
import { useSettingsStore, exportSettingsJson } from "../store/settingsStore";
import { shellMeta, collectLeaves } from "../lib/layout";
import { askConfirm, askPrompt } from "./AppDialog";
import { deleteCustomTemplate, loadCustomTemplates } from "../lib/customTemplates";
import { useShellCatalogStore } from "../store/shellCatalogStore";
import {
  extractParams,
  renderSnippet,
  snippetsForShell,
  type Snippet,
} from "../lib/snippets";

/** Fill snippet params via light prompt dialogs, then insert (no run). */
export async function insertSnippetInteractive(
  snippet: Snippet,
  insertToPane: (serial: number | undefined, text: string, run: boolean) => void,
): Promise<void> {
  const names = extractParams(snippet.template);
  const values: Record<string, string> = {};
  for (const name of names) {
    const def = snippet.params.find((p) => p.name === name)?.default ?? "";
    const v = await askPrompt(`片段参数 · ${name}`, {
      message: `「${snippet.name}」需要参数 ${name}`,
      defaultValue: def,
      placeholder: def || name,
    });
    if (v == null) return; // cancelled
    values[name] = v;
  }
  insertToPane(undefined, renderSnippet(snippet, values), false);
}

type Item = {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
};

/** Product enhancement: Ctrl+Shift+P command palette for power users. */
export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const createTabFromProfile = useWorkbenchStore((s) => s.createTabFromProfile);
  const addPane = useWorkbenchStore((s) => s.addPane);
  const shellProfiles = useShellCatalogStore((s) => s.profiles);
  const setAiOpen = useWorkbenchStore((s) => s.setAiOpen);
  const aiOpen = useWorkbenchStore((s) => s.aiOpen);
  const clearPane = useWorkbenchStore((s) => s.clearPane);
  const newAgentSession = useWorkbenchStore((s) => s.newAgentSession);
  const setActivePane = useWorkbenchStore((s) => s.setActivePane);
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const tabs = useWorkbenchStore((s) => s.tabs);
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);
  const patch = useSettingsStore((s) => s.patch);
  const applyPreset = useSettingsStore((s) => s.applyPreset);
  const exportWorkbench = useWorkbenchStore((s) => s.exportWorkbench);
  const importWorkbench = useWorkbenchStore((s) => s.importWorkbench);
  const toggleFocusMaximize = useWorkbenchStore((s) => s.toggleFocusMaximize);
  const focusMaximized = useWorkbenchStore((s) => s.focusMaximized);
  const applyLayoutTemplate = useWorkbenchStore((s) => s.applyLayoutTemplate);
  const applyCustomTemplate = useWorkbenchStore((s) => s.applyCustomTemplate);
  const saveCurrentAsTemplate = useWorkbenchStore((s) => s.saveCurrentAsTemplate);
  const saveWorkspace = useWorkbenchStore((s) => s.saveWorkspace);
  const switchWorkspace = useWorkbenchStore((s) => s.switchWorkspace);
  const listWorkspaces = useWorkbenchStore((s) => s.listWorkspaces);
  const insertToPane = useWorkbenchStore((s) => s.insertToPane);

  const items: Item[] = useMemo(() => {
    // Closed palette needs no items; skip the localStorage reads + layout walk.
    if (!open) return [];
    const list: Item[] = [
      {
        id: "ai-focus",
        label: "聚焦 Agent（工作台中枢）",
        hint: "推荐",
        run: () => {
          if (!useSettingsStore.getState().aiEnabled) {
            toastMsg("Agent 已在设置中停用 · 请到 设置 → Agent 启用");
            return;
          }
          setAiOpen(true);
          window.setTimeout(() => {
            document.getElementById("ai-input")?.focus();
          }, 50);
          toastMsg("Agent 已就绪 · 直接描述你要做的事");
        },
      },
      {
        id: "ai-toggle",
        label: aiOpen ? "隐藏 Agent 面板" : "显示 Agent 面板",
        hint: "Ctrl+Shift+A",
        run: () => setAiOpen(!aiOpen),
      },
      {
        id: "ai-new",
        label: "新建 Agent 会话",
        run: () => {
          setAiOpen(true);
          newAgentSession();
        },
      },
      {
        id: "settings",
        label: "打开设置",
        hint: "Ctrl+,",
        run: () => nav("/settings"),
      },
      {
        id: "split-h",
        label: "向右拆分窗格",
        hint: "Alt+Shift+D",
        run: () => addPane("h"),
      },
      {
        id: "split-v",
        label: "向下拆分窗格",
        hint: "Alt+Shift+E",
        run: () => addPane("v"),
      },
      {
        id: "max-pane",
        label: focusMaximized ? "还原分屏布局" : "最大化焦点窗格",
        hint: "Ctrl+Shift+M",
        run: () => toggleFocusMaximize(),
      },
      {
        id: "clear",
        label: "清屏焦点窗格",
        hint: "Ctrl+L",
        run: () => clearPane(),
      },
      {
        id: "export",
        label: "导出工作台 JSON",
        run: () => exportWorkbench(),
      },
      {
        id: "import",
        label: "导入工作台 JSON…",
        run: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "application/json,.json";
          input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            void file.text().then((t) => importWorkbench(t));
          };
          input.click();
        },
      },
      {
        id: "theme-cycle",
        label: "切换主题预设",
        run: () => {
          const order = ["cyan", "green", "violet", "amber", "slate"];
          const cur = useSettingsStore.getState().themePreset;
          const next = order[(order.indexOf(cur) + 1) % order.length];
          applyPreset(next);
          toastMsg(`主题 · ${next}`);
        },
      },
      ...shellProfiles.map((p) => ({
        id: `tab-${p.id}`,
        label: `新建标签 · ${p.name}`,
        run: () => createTabFromProfile(p),
      })),
      {
        id: "tpl-single",
        label: "布局模板 · 单窗格",
        run: () => applyLayoutTemplate("single"),
      },
      {
        id: "tpl-dual",
        label: "布局模板 · 左右双屏",
        run: () => applyLayoutTemplate("edit-build"),
      },
      {
        id: "tpl-log",
        label: "布局模板 · 编辑+构建+日志",
        run: () => applyLayoutTemplate("edit-build-log"),
      },
      {
        id: "tpl-triple",
        label: "布局模板 · 三列",
        run: () => applyLayoutTemplate("triple-h"),
      },
      {
        id: "tpl-save",
        label: "保存当前布局为模板…",
        run: () => {
          void askPrompt("保存布局模板", {
            message: "输入模板名称",
            defaultValue: "我的布局",
          }).then((name) => {
            if (name) saveCurrentAsTemplate(name);
          });
        },
      },
      ...loadCustomTemplates().flatMap((t) => [
        {
          id: `ctpl-${t.id}`,
          label: `自定义模板 · ${t.name}`,
          run: () => applyCustomTemplate(t.id),
        },
        {
          id: `ctpl-del-${t.id}`,
          label: `删除自定义模板 · ${t.name}`,
          run: () => {
            void askConfirm(`删除模板「${t.name}」？`, {
              danger: true,
              okLabel: "删除",
            }).then((ok) => {
              if (ok) {
                deleteCustomTemplate(t.id);
                toastMsg(`已删除模板 · ${t.name}`);
              }
            });
          },
        },
      ]),
      ...(() => {
        const st = useWorkbenchStore.getState();
        const shellKey = st.activePane()?.shellKey || "ps";
        return snippetsForShell(shellKey).map((s) => ({
          id: `snip-${s.id}`,
          label: `片段 · ${s.name}`,
          hint: s.template.length > 32 ? `${s.template.slice(0, 30)}…` : s.template,
          run: () => {
            void insertSnippetInteractive(s, insertToPane);
          },
        }));
      })(),
      {
        id: "rec-toggle",
        label: "录制当前窗格 · 开始/停止",
        hint: ".cast",
        run: () => {
          void (async () => {
            const { getLiveTerm } = await import("../features/terminal/termRegistry");
            const { recordStart, recordStop, recordStatus } = await import(
              "../lib/recording"
            );
            const st = useWorkbenchStore.getState();
            const paneId = st.activePaneId;
            const live = paneId ? getLiveTerm(paneId) : undefined;
            if (!live?.ptyId || live.disposed) {
              toastMsg("焦点窗格没有活动的 PTY 会话");
              return;
            }
            try {
              if (await recordStatus(live.ptyId)) {
                const p = await recordStop(live.ptyId);
                if (p) {
                  localStorage.setItem("sw-last-cast", p);
                  toastMsg(`录像已保存: ${p}`);
                }
              } else {
                const p = await recordStart(
                  live.ptyId,
                  live.term.cols,
                  live.term.rows,
                );
                localStorage.setItem("sw-last-cast", p);
                toastMsg(`开始录制 → ${p}`);
              }
            } catch (e) {
              toastMsg(`录制失败: ${e instanceof Error ? e.message : e}`);
            }
          })();
        },
      },
      {
        id: "rec-play",
        label: "打开录像回放…",
        run: () => {
          void askPrompt("打开录像", {
            message: "输入 .cast 文件完整路径",
            defaultValue: localStorage.getItem("sw-last-cast") ?? "",
            placeholder: "~/aether-recordings/aether-*.cast",
          }).then((p) => {
            if (p?.trim()) {
              window.dispatchEvent(
                new CustomEvent("sw:open-cast", { detail: { path: p.trim() } }),
              );
            }
          });
        },
      },
      {
        id: "aether-md",
        label: "为当前项目创建 AETHER.md（Agent 起草）",
        run: () => {
          if (!useSettingsStore.getState().aiEnabled) {
            toastMsg("需要启用 Agent（设置 → Agent）");
            return;
          }
          setAiOpen(true);
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("sw:ai-send", {
                detail: {
                  text: "请查看当前焦点窗格的 cwd 与目录结构（可 run_command 列目录），然后在项目根目录起草一份 AETHER.md：包含项目简介、目录结构说明、常用命令（构建/测试/运行）、注意事项。先给我看内容，确认后再写入文件。",
                },
              }),
            );
          }, 80);
        },
      },
      {
        id: "ws-save",
        label: "保存当前为工作区…",
        run: () => {
          void askPrompt("保存工作区", {
            message: "输入工作区名称",
            defaultValue: "我的项目",
          }).then((name) => {
            if (name) saveWorkspace(name);
          });
        },
      },
      ...listWorkspaces().map((w) => ({
        id: `ws-${w.id}`,
        label: `切换工作区 · ${w.name}`,
        run: () => switchWorkspace(w.id),
      })),
    ];

    for (const tab of tabs) {
      for (const leaf of collectLeaves(tab.layout)) {
        list.push({
          id: `focus-${leaf.id}`,
          label: `聚焦窗格 #${leaf.serial} · ${shellMeta(leaf.shellKey).short}`,
          hint: tab.title,
          run: () => {
            setActiveTab(tab.id);
            setActivePane(leaf.id);
          },
        });
      }
    }

    list.push({
      id: "export-settings",
      label: "导出设置 JSON",
      run: () => {
        const blob = new Blob([exportSettingsJson()], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "shell-workbench-settings.json";
        a.click();
        toastMsg("已导出设置（已移除密钥字段）");
      },
    });

    list.push({
      id: "accent",
      label: "强调色 · 青 / 绿 / 蓝 / 橙 循环",
      run: () => {
        const hues = [195, 145, 250, 35];
        const cur = useSettingsStore.getState().accentHue;
        const next = hues[(hues.indexOf(cur) + 1) % hues.length];
        patch({ accentHue: next });
        toastMsg(`强调色 hue ${next}`);
      },
    });

    return list;
  }, [
    open,
    aiOpen,
    tabs,
    addPane,
    clearPane,
    createTabFromProfile,
    shellProfiles,
    nav,
    newAgentSession,
    setActivePane,
    setActiveTab,
    setAiOpen,
    toastMsg,
    patch,
    applyPreset,
    exportWorkbench,
    importWorkbench,
    toggleFocusMaximize,
    focusMaximized,
    applyLayoutTemplate,
    applyCustomTemplate,
    saveCurrentAsTemplate,
    saveWorkspace,
    switchWorkspace,
    listWorkspaces,
    insertToPane,
  ]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(qq) || (i.hint && i.hint.toLowerCase().includes(qq)),
    );
  }, [items, q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  if (!open) return null;

  return (
    <div
      className="cmd-palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmd-palette" role="dialog" aria-label="命令面板">
        <input
          className="cmd-palette-input"
          autoFocus
          placeholder="输入命令…（Ctrl+Shift+P）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(filtered.length - 1, i + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const item = filtered[idx];
              if (item) {
                item.run();
                onClose();
              }
            }
          }}
        />
        <div className="cmd-palette-list">
          {filtered.length === 0 && (
            <div className="cmd-palette-empty">无匹配命令</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`cmd-palette-item${i === idx ? " active" : ""}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => {
                item.run();
                onClose();
              }}
            >
              <span>{item.label}</span>
              {item.hint && <kbd>{item.hint}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
