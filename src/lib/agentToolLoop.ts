/**
 * OpenAI-compatible tool loop for Aether Agent.
 * Model can call run_command / read_pane / list_panes; client executes and continues.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./window";
import { getPaneOutput } from "./paneRegistry";
import { resolveDangerAction } from "./danger";
import { redactAndTrimContext } from "./contextRedact";
import { useWorkbenchStore } from "../store/workbenchStore";
import { useSettingsStore } from "../store/settingsStore";
import { collectLeaves } from "./layout";
import { getLivePtyId, listLiveTerms } from "../features/terminal/termRegistry";
import { ptyWrite } from "../ipc/pty";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ToolChatRound = {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
  assistantMessage: unknown;
};

export const AGENT_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "list_panes",
      description: "列出工作台中所有终端窗格（标签、#序号、shell、cwd、是否焦点）。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_pane",
      description:
        "读取指定窗格最近的终端输出（已脱敏）。blocks=true 时返回结构化命令块列表（命令/退出码/耗时），并附最近一块的输出。",
      parameters: {
        type: "object",
        properties: {
          serial: { type: "integer", description: "窗格 #N 序号；省略则用焦点窗格" },
          lines: { type: "integer", description: "最多行数，默认 40，最大 80" },
          blocks: {
            type: "boolean",
            description: "true=返回结构化命令块（需 Shell 集成）",
          },
          failed_only: {
            type: "boolean",
            description: "配合 blocks：只看失败（exit≠0）的块",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "在指定窗格执行一条 shell 命令（写入并回车）。危险命令在确认模式下可能仅插入不执行。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "完整命令" },
          serial: { type: "integer", description: "窗格 #N；省略=焦点" },
          wait_ms: {
            type: "integer",
            description: "执行后等待毫秒再返回。默认 2500，最大 12000",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "split_pane",
      description:
        "在当前焦点窗格内分屏，创建新终端窗格。用户说「左右分屏/上下分屏/再开一个窗格」时必须调用此工具，不要只教用户点 UI。",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["left_right", "top_bottom", "h", "v"],
            description: "left_right 或 h=左右；top_bottom 或 v=上下。默认 left_right",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "new_tab",
      description: "新建一个终端标签页（可选指定 shell_key，如 ps/bash/cmd/wsl）。",
      parameters: {
        type: "object",
        properties: {
          shell_key: {
            type: "string",
            description: "shell 类型键，如 ps、bash、cmd、wsl；省略则用默认",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_pane",
      description: "关闭指定 #N 窗格（至少保留一个）。",
      parameters: {
        type: "object",
        properties: {
          serial: { type: "integer", description: "窗格 #N；省略=焦点窗格" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "focus_pane",
      description: "聚焦到指定 #N 窗格。",
      parameters: {
        type: "object",
        properties: {
          serial: { type: "integer", description: "窗格 #N" },
        },
        required: ["serial"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_pane",
      description: "清屏指定或焦点窗格的终端显示。",
      parameters: {
        type: "object",
        properties: {
          serial: { type: "integer", description: "窗格 #N；省略=焦点" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_layout_template",
      description: "应用内置布局模板。id 如 single、edit-build、edit-build-log、triple-h（可 list=true 查看）。",
      parameters: {
        type: "object",
        properties: {
          template_id: {
            type: "string",
            description: "模板 id；也可传 list 先查看可用模板",
          },
          list: {
            type: "boolean",
            description: "为 true 时只列出模板，不应用",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace",
      description: "工作区：list 列出；save 保存当前布局；switch 切换到已有工作区。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "save", "switch"],
            description: "list | save | switch",
          },
          name: { type: "string", description: "save 时的名称" },
          id: { type: "string", description: "switch 时的工作区 id" },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "app_settings",
      description:
        "调整应用设置：主题、不透明度、Agent 执行模式、字号、上下文范围等。敏感项（API Key）不要用此工具写入。",
      parameters: {
        type: "object",
        properties: {
          theme: {
            type: "string",
            description: "主题预设 id：cyan | green | violet | amber | slate",
          },
          opacity: {
            type: "integer",
            description: "界面不透明度 40–100",
          },
          exec_mode: {
            type: "string",
            enum: ["insert", "confirm", "auto"],
            description: "Agent 命令执行方式",
          },
          font_size: { type: "integer", description: "终端字号 11–20" },
          context_scope: {
            type: "string",
            enum: ["focus", "activeTab", "allTabs"],
          },
          ai_open: {
            type: "boolean",
            description: "是否打开 Agent 面板",
          },
        },
        additionalProperties: false,
      },
    },
  },
] as const;

/**
 * One STREAMING chat round (0.7 kernel): text/thinking stream to the UI via
 * `agent://stream` events with the given streamId; tool calls come back in
 * the result. Cancellable mid-flight via agentChatCancel(streamId).
 */
export async function agentChatStreamToolsRound(req: {
  endpoint: string;
  apiKey?: string;
  provider?: string;
  model: string;
  messages: unknown;
  tools?: unknown;
  streamId: string;
  effort?: string;
}): Promise<ToolChatRound> {
  if (!isTauri()) throw new Error("tool loop requires tauri");
  try {
    const raw = await invoke<{
      content: string | null;
      toolCalls?: ToolCall[];
      tool_calls?: ToolCall[];
      finishReason?: string | null;
      finish_reason?: string | null;
      assistantMessage?: unknown;
      assistant_message?: unknown;
    }>("agent_chat_stream_tools", {
      req: {
        endpoint: req.endpoint.trim().replace(/\/$/, ""),
        apiKey: req.apiKey?.trim() || null,
        provider: req.provider || null,
        model: req.model,
        messages: req.messages,
        tools: req.tools ?? AGENT_TOOLS_OPENAI,
        streamId: req.streamId,
        effort: req.effort || null,
      },
    });
    // Serde may emit snake_case or camelCase depending on path
    const toolCalls = raw.toolCalls || raw.tool_calls || [];
    return {
      content: raw.content,
      toolCalls,
      finishReason: raw.finishReason ?? raw.finish_reason ?? null,
      assistantMessage: raw.assistantMessage ?? raw.assistant_message ?? {},
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Normalize opaque reqwest errors
    if (/error decoding response body/i.test(msg)) {
      throw new Error(
        "响应体解码失败（网关压缩/协议不兼容）。将回退流式对话；若持续失败请确认端点为 OpenAI /v1 且支持 JSON。",
      );
    }
    throw e instanceof Error ? e : new Error(msg);
  }
}

function sleep(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms));
}

export async function executeAgentTool(
  name: string,
  argsJson: string,
): Promise<{ ok: boolean; result: string }> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return { ok: false, result: `无效 JSON 参数: ${argsJson.slice(0, 200)}` };
  }

  const st = useWorkbenchStore.getState();
  const settings = useSettingsStore.getState();

  if (name === "list_panes") {
    const rows: string[] = [];
    st.tabs.forEach((tab, ti) => {
      for (const leaf of collectLeaves(tab.layout)) {
        const focus = leaf.id === st.activePaneId ? " [焦点]" : "";
        rows.push(
          `T${ti + 1}:#${leaf.serial} 「${tab.title}」 ${leaf.shellKey} cwd=${leaf.cwd}${focus}`,
        );
      }
    });
    return {
      ok: true,
      result: rows.length ? rows.join("\n") : "（无窗格）",
    };
  }

  if (name === "split_pane") {
    const dirRaw = String(args.direction || "left_right").toLowerCase();
    const dir: "h" | "v" =
      dirRaw === "v" ||
      dirRaw === "top_bottom" ||
      dirRaw === "vertical" ||
      dirRaw === "上下"
        ? "v"
        : "h";
    const before = st.activePane();
    const beforeCount = st.activeTab()
      ? collectLeaves(st.activeTab()!.layout).length
      : 0;
    st.addPane(dir);
    const after = useWorkbenchStore.getState();
    const focus = after.activePane();
    const afterCount = after.activeTab()
      ? collectLeaves(after.activeTab()!.layout).length
      : 0;
    if (afterCount <= beforeCount) {
      return {
        ok: false,
        result: "分屏未成功（可能已达窗格上限）。请 list_panes 查看当前布局。",
      };
    }
    return {
      ok: true,
      result: `已${dir === "h" ? "左右" : "上下"}分屏：原焦点 #${before?.serial ?? "?"}，新窗格 #${focus?.serial ?? "?"}。当前共 ${afterCount} 个窗格。`,
    };
  }

  if (name === "new_tab") {
    const shellKey = String(args.shell_key || args.shellKey || "").trim();
    const beforeTabs = st.tabs.length;
    if (shellKey) {
      st.createTab(shellKey);
    } else {
      const def =
        useSettingsStore.getState().defaultShell ||
        st.activeTab()?.shellKey ||
        "ps";
      st.createTab(def);
    }
    const after = useWorkbenchStore.getState();
    if (after.tabs.length <= beforeTabs) {
      return { ok: false, result: "新建标签失败" };
    }
    const tab = after.activeTab();
    const pane = after.activePane();
    return {
      ok: true,
      result: `已新建标签「${tab?.title ?? "?"}」· 焦点窗格 #${pane?.serial ?? 1} · shell=${tab?.shellKey ?? "?"}`,
    };
  }

  if (name === "close_pane") {
    const serial =
      args.serial != null && args.serial !== ""
        ? Number(args.serial)
        : st.activePane()?.serial;
    const leaf =
      serial != null ? st.resolveSerial(serial) : st.activePane();
    if (!leaf) {
      return { ok: false, result: `窗格 #${serial ?? "?"} 不存在` };
    }
    const tab = st.activeTab();
    if (tab && collectLeaves(tab.layout).length <= 1) {
      return {
        ok: false,
        result: "当前标签仅剩一个窗格，无法关闭（可关闭整个标签）。",
      };
    }
    st.closePane(leaf.id);
    return { ok: true, result: `已关闭窗格 #${leaf.serial}` };
  }

  if (name === "focus_pane") {
    const serial = Number(args.serial);
    if (!Number.isFinite(serial)) {
      return { ok: false, result: "缺少 serial" };
    }
    const leaf = st.resolveSerial(serial);
    if (!leaf) {
      return { ok: false, result: `窗格 #${serial} 不存在` };
    }
    for (const tab of st.tabs) {
      if (collectLeaves(tab.layout).some((l) => l.id === leaf.id)) {
        st.setActiveTab(tab.id);
        break;
      }
    }
    st.setActivePane(leaf.id);
    return { ok: true, result: `已聚焦窗格 #${leaf.serial}` };
  }

  if (name === "read_pane") {
    const serial =
      args.serial != null && args.serial !== ""
        ? Number(args.serial)
        : st.activePane()?.serial;
    const lines = Math.min(80, Math.max(10, Number(args.lines) || 40));
    const leaf =
      serial != null ? st.resolveSerial(serial) : st.activePane();
    if (!leaf) {
      return { ok: false, result: `窗格 #${serial ?? "?"} 不存在` };
    }

    // Structured command blocks (OSC 133) — needs shell integration
    if (args.blocks === true || args.blocks === "true") {
      const { getBlocks, blockHeader, readBlockOutput } = await import(
        "./commandBlocks"
      );
      const { getLiveTerm } = await import("../features/terminal/termRegistry");
      const failedOnly = args.failed_only === true || args.failed_only === "true";
      let list = getBlocks(leaf.id);
      if (failedOnly) {
        list = list.filter((b) => !b.running && b.exitCode != null && b.exitCode !== 0);
      }
      if (!list.length) {
        return {
          ok: true,
          result: failedOnly
            ? `#${leaf.serial} 暂无失败的命令块。`
            : `#${leaf.serial} 暂无命令块（需要 Shell 集成：pwsh/bash/zsh，且设置里已开启）。可退回普通 read_pane。`,
        };
      }
      const recent = list.slice(-10);
      const rows = recent.map((b, i) => `${i + 1}. ${blockHeader(b)}`);
      const last = recent[recent.length - 1];
      const live = getLiveTerm(leaf.id);
      const out = live ? readBlockOutput(live.term, last, 80) : null;
      const outText = out
        ? `\n--- 最近一块输出 ---\n${redactAndTrimContext(out, 3000)}`
        : "";
      return {
        ok: true,
        result: `#${leaf.serial} 命令块（近 ${recent.length} 条）:\n${rows.join("\n")}${outText}`,
      };
    }

    const raw = getPaneOutput(leaf.id, lines);
    const text = redactAndTrimContext(raw || "（暂无输出）", 4000);
    return {
      ok: true,
      result: `#${leaf.serial} ${leaf.shellKey} ${leaf.cwd}\n${text}`,
    };
  }

  if (name === "run_command") {
    const command = String(args.command || "").trim();
    if (!command) return { ok: false, result: "缺少 command" };
    // Prefer explicit serial; otherwise always focus pane (never guess another tab's #1)
    const serial =
      args.serial != null && args.serial !== ""
        ? Number(args.serial)
        : st.activePane()?.serial;
    const waitMs = Math.min(12000, Math.max(800, Number(args.wait_ms) || 2500));

    let leaf =
      serial != null ? st.resolveSerial(serial) : st.activePane();
    if (!leaf) {
      return { ok: false, result: `目标窗格不存在 (#${serial ?? "焦点"})` };
    }

    // Wait for live PTY (create is async; leaf.ptyId is often empty)
    let ptyId = getLivePtyId(leaf.id) || leaf.ptyId || null;
    for (let i = 0; i < 20 && !ptyId; i++) {
      await sleep(150);
      leaf = (serial != null ? st.resolveSerial(serial) : st.activePane()) || leaf;
      ptyId = getLivePtyId(leaf.id) || leaf.ptyId || null;
      if (!ptyId) {
        const lives = listLiveTerms();
        if (lives.length === 1) {
          ptyId = lives[0].ptyId;
          // retarget leaf if we can find it
          for (const tab of useWorkbenchStore.getState().tabs) {
            const L = collectLeaves(tab.layout).find((x) => x.id === lives[0].paneId);
            if (L) {
              leaf = L;
              break;
            }
          }
        }
      }
    }
    if (!ptyId) {
      const n = listLiveTerms().length;
      return {
        ok: false,
        result:
          n === 0
            ? `终端 PTY 未就绪（0 个活动会话）。请先点一下终端区域或新开标签，再重试。命令未执行: ${command}`
            : `窗格 #${leaf.serial} 无 live PTY（活动会话 ${n} 个）。请点一下该窗格。未执行: ${command}`,
      };
    }

    // Focus the target pane BEFORE any write — even insert-only must be visible
    // (a dangerous command silently inserted into a background pane is a trap)
    st.setActivePane(leaf.id);
    for (const tab of st.tabs) {
      if (collectLeaves(tab.layout).some((l) => l.id === leaf.id)) {
        if (tab.id !== st.activeTabId) st.setActiveTab(tab.id);
        break;
      }
    }

    // Shared policy with the store path (resolveDangerAction) — channels must agree
    const decision = resolveDangerAction(command, settings, true);
    if (!decision.run) {
      await ptyWrite(ptyId, command);
      if (decision.note === "danger-insert") {
        useWorkbenchStore.getState().toastMsg("⚠ 危险命令 · 已改为仅插入，请在终端确认后手动回车");
        return {
          ok: false,
          result: `危险命令已仅插入未执行（确认模式）· 已聚焦窗格 #${leaf.serial}，等待用户手动回车: ${command}`,
        };
      }
      return {
        ok: true,
        result: `已按「仅插入」写入 #${leaf.serial}（未回车）: ${command}`,
      };
    }
    if (decision.note === "danger-auto-run") {
      useWorkbenchStore.getState().toastMsg("⚠ 危险命令 · 已按自动模式执行");
    }

    const beforeOut = getPaneOutput(leaf.id, 8);
    // Direct PTY write — do not depend on insertToPane / leaf.ptyId
    try {
      // Feed block tracker so OSC 133 C-mark can attach the command text
      const { getLiveTerm } = await import("../features/terminal/termRegistry");
      getLiveTerm(leaf.id)?.blocks?.noteSubmittedCommand(command);
      await ptyWrite(ptyId, `${command}\r`);
      // History only (insertToPane would write again)
      const { recordCommand } = await import("./commandHistory");
      recordCommand(command, leaf.shellKey, settings.historyLimit);
      st.notePaneCommand(leaf.id, command);
    } catch (e) {
      return {
        ok: false,
        result: `ptyWrite 失败: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const leafId = leaf.id;
    const deadline = Date.now() + waitMs;
    let out = getPaneOutput(leafId, 60);
    while (Date.now() < deadline) {
      await sleep(300);
      out = getPaneOutput(leafId, 60);
      if (out && out !== beforeOut && out.length > (beforeOut?.length || 0)) break;
    }
    const text = redactAndTrimContext(
      out || "（暂无输出 · 命令可能仍在运行）",
      4000,
    );
    const wrote =
      !!out && out !== beforeOut
        ? "终端输出已变化"
        : "输出未明显变化（命令可能无回显或仍在跑）";
    return {
      ok: true,
      result: `已在 #${leaf.serial} 执行: ${command}\n[${wrote}]\n--- 输出 ---\n${text}`,
    };
  }

  if (name === "clear_pane") {
    const serial =
      args.serial != null && args.serial !== ""
        ? Number(args.serial)
        : st.activePane()?.serial;
    const leaf =
      serial != null ? st.resolveSerial(serial) : st.activePane();
    if (!leaf) {
      return { ok: false, result: `窗格 #${serial ?? "?"} 不存在` };
    }
    st.setActivePane(leaf.id);
    st.clearPane(leaf.id);
    return { ok: true, result: `已清屏窗格 #${leaf.serial}` };
  }

  if (name === "apply_layout_template") {
    const { BUILTIN_TEMPLATES, getTemplate } = await import("./layoutTemplates");
    if (args.list === true || args.list === "true") {
      const lines = BUILTIN_TEMPLATES.map(
        (t) => `${t.id} — ${t.name}：${t.description}`,
      );
      return { ok: true, result: lines.join("\n") || "（无内置模板）" };
    }
    const id = String(args.template_id || args.templateId || args.id || "").trim();
    if (!id) {
      return {
        ok: false,
        result: "请提供 template_id，或 list=true 查看可用模板",
      };
    }
    const t = getTemplate(id);
    if (!t) {
      return {
        ok: false,
        result: `未知模板 ${id}。可用: ${BUILTIN_TEMPLATES.map((x) => x.id).join(", ")}`,
      };
    }
    st.applyLayoutTemplate(id);
    return { ok: true, result: `已应用布局模板「${t.name}」(${t.id})` };
  }

  if (name === "workspace") {
    const action = String(args.action || "").toLowerCase();
    if (action === "list") {
      const list = st.listWorkspaces();
      if (!list.length) return { ok: true, result: "（暂无已保存工作区）" };
      return {
        ok: true,
        result: list.map((w) => `${w.id} — ${w.name}`).join("\n"),
      };
    }
    if (action === "save") {
      const name = String(args.name || "").trim() || `工作区 ${new Date().toLocaleString()}`;
      st.saveWorkspace(name);
      return { ok: true, result: `已保存工作区「${name}」` };
    }
    if (action === "switch") {
      const id = String(args.id || "").trim();
      if (!id) return { ok: false, result: "switch 需要 id" };
      st.switchWorkspace(id);
      return { ok: true, result: `已切换工作区 ${id}` };
    }
    return { ok: false, result: "action 须为 list | save | switch" };
  }

  if (name === "app_settings") {
    const patch: Record<string, unknown> = {};
    const notes: string[] = [];
    if (args.theme != null) {
      const id = String(args.theme);
      settings.applyPreset(id);
      notes.push(`主题=${id}`);
    }
    if (args.opacity != null) {
      const n = Math.min(100, Math.max(40, Number(args.opacity)));
      patch.uiOpacity = n;
      notes.push(`不透明度=${n}%`);
    }
    if (args.exec_mode != null || args.execMode != null) {
      const m = String(args.exec_mode ?? args.execMode);
      if (["insert", "confirm", "auto"].includes(m)) {
        patch.execMode = m;
        notes.push(`执行方式=${m}`);
      }
    }
    if (args.font_size != null || args.fontSize != null) {
      const n = Math.min(20, Math.max(11, Number(args.font_size ?? args.fontSize)));
      patch.fontSize = n;
      notes.push(`字号=${n}`);
    }
    if (args.context_scope != null || args.contextScope != null) {
      const m = String(args.context_scope ?? args.contextScope);
      if (["focus", "activeTab", "allTabs"].includes(m)) {
        patch.contextScope = m;
        notes.push(`上下文=${m}`);
      }
    }
    if (args.ai_open != null || args.aiOpen != null) {
      const open = Boolean(args.ai_open ?? args.aiOpen);
      st.setAiOpen(open);
      notes.push(`Agent面板=${open ? "开" : "关"}`);
    }
    if (Object.keys(patch).length) {
      settings.patch(patch as Partial<typeof settings>);
    }
    if (!notes.length) {
      return {
        ok: false,
        result:
          "未提供可改字段。可用: theme, opacity, exec_mode, font_size, context_scope, ai_open",
      };
    }
    return { ok: true, result: `已更新: ${notes.join(" · ")}` };
  }

  return { ok: false, result: `未知工具: ${name}` };
}

/** Heuristic: tool output looks like CLI is waiting for interactive input */
export function looksLikeInteractivePrompt(text: string): boolean {
  if (!text) return false;
  const t = text.slice(-800);
  return (
    /\b(yes|no|continue|quit|abort|trust)\b/i.test(t) ||
    /\[Y\/n\]|\(y\/N\)|Y\/n|y\/N/i.test(t) ||
    /Do you trust|press\s+[0-9yn]|输入\s*[0-9yn]|按\s*[0-9yn]/i.test(t) ||
    /^\s*[\[(]?\s*[12]\s*[\]).:：]/m.test(t) ||
    /信任.*目录|是否继续|确认执行/i.test(t)
  );
}

export type ToolTraceStep = {
  name: string;
  argsPreview: string;
  ok: boolean;
  summary: string;
};

export type ToolLoopCallbacks = {
  onStatus?: (msg: string) => void;
  onDelta?: (text: string) => void;
  onToolStart?: (name: string, argsPreview: string) => void;
  onToolEnd?: (step: ToolTraceStep) => void;
  shouldAbort?: () => boolean;
};

/**
 * Run up to maxRounds of STREAMING tool-call rounds (0.7 kernel).
 *
 * Text/thinking of every round streams live to the UI via `agent://stream`
 * events carrying opts.streamId — the caller listens and renders previews.
 * The returned text joins all rounds' content so nothing the model said
 * between tool calls is lost. Cancel via agentChatCancel(streamId): the
 * in-flight HTTP round aborts and the loop returns { cancelled: true }.
 */
export async function runAgentToolLoop(opts: {
  endpoint: string;
  apiKey?: string;
  provider?: string;
  model: string;
  /** Full messages array including system + history + user (mutable copy) */
  messages: unknown[];
  maxRounds?: number;
  /** Stream id shared by every round — register BEFORE calling, cancel any time */
  streamId: string;
  /** low | medium | high | max */
  effort?: string;
  cb?: ToolLoopCallbacks;
}): Promise<{
  text: string;
  usedTools: boolean;
  rounds: number;
  trace: ToolTraceStep[];
  cancelled: boolean;
}> {
  const maxRounds = opts.maxRounds ?? 4;
  const messages = [...opts.messages];
  let usedTools = false;
  const texts: string[] = [];
  const trace: ToolTraceStep[] = [];
  const joined = () => texts.join("\n\n").trim();

  const round = (tools: unknown) =>
    agentChatStreamToolsRound({
      endpoint: opts.endpoint,
      apiKey: opts.apiKey,
      provider: opts.provider,
      model: opts.model,
      messages,
      tools,
      streamId: opts.streamId,
      effort: opts.effort,
    });

  for (let r = 0; r < maxRounds; r++) {
    if (opts.cb?.shouldAbort?.()) {
      return { text: joined() || "（已停止）", usedTools, rounds: r, trace, cancelled: true };
    }
    opts.cb?.onStatus?.(r === 0 ? "思考中…" : `工具回合 ${r}/${maxRounds}…`);

    const res = await round(AGENT_TOOLS_OPENAI);

    if (res.content) texts.push(res.content);

    if (res.finishReason === "cancelled") {
      return { text: joined(), usedTools, rounds: r + 1, trace, cancelled: true };
    }

    if (!res.toolCalls.length) {
      return {
        text: joined() || "（空回复）",
        usedTools,
        rounds: r + 1,
        trace,
        cancelled: false,
      };
    }

    usedTools = true;
    messages.push(res.assistantMessage);

    for (const tc of res.toolCalls) {
      if (opts.cb?.shouldAbort?.()) {
        return { text: joined() || "（已停止）", usedTools, rounds: r + 1, trace, cancelled: true };
      }
      const argsPreview = (tc.arguments || "").slice(0, 80);
      opts.cb?.onStatus?.(`调用 ${tc.name}…`);
      opts.cb?.onToolStart?.(tc.name, argsPreview);
      const exec = await executeAgentTool(tc.name, tc.arguments);
      const step: ToolTraceStep = {
        name: tc.name,
        argsPreview,
        ok: exec.ok,
        summary: exec.result.slice(0, 160).replace(/\s+/g, " "),
      };
      trace.push(step);
      opts.cb?.onToolEnd?.(step);

      let toolContent = exec.result;
      // Nudge: interactive CLI waiting for input → remind model to emit actions
      if (
        (tc.name === "run_command" || tc.name === "read_pane") &&
        looksLikeInteractivePrompt(exec.result)
      ) {
        toolContent +=
          "\n\n[系统提示] 终端似乎在等待交互输入。请在最终回复中用 Actions skill 输出 JSON actions，为每个选项提供一键按钮（command=用户应输入的内容），不要只口头说明。";
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolContent,
      });
    }
  }

  opts.cb?.onStatus?.("汇总结果…");
  const final = await round([]);
  if (final.content) texts.push(final.content);
  const cancelled = final.finishReason === "cancelled";
  return {
    text: joined() || "（达到工具回合上限，请根据终端输出继续）",
    usedTools,
    rounds: maxRounds + 1,
    trace,
    cancelled,
  };
}
