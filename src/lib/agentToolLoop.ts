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
        "在指定窗格执行一条 shell 命令（写入并回车）。危险命令在确认模式下可能仅插入不执行。wait_for_exit=true 时等待命令块退出码（需 Shell 集成，最长 120s）——任务步骤执行请务必开启。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "完整命令" },
          serial: { type: "integer", description: "窗格 #N；省略=焦点" },
          wait_ms: {
            type: "integer",
            description: "执行后等待毫秒再返回。默认 2500，最大 12000（wait_for_exit 时为超时上限，默认 120000）",
          },
          wait_for_exit: {
            type: "boolean",
            description: "true=阻塞至命令结束并返回退出码（推荐任务步骤使用）",
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
      name: "task_create",
      description:
        "创建多步任务计划（任务面板可见，用户可监督）。创建后按步骤用 run_command(wait_for_exit=true) 执行并 task_update_step 推进。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "任务标题" },
          steps: {
            type: "array",
            description: "步骤列表（按执行顺序）",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "步骤说明" },
                command: { type: "string", description: "该步骤的 shell 命令（可选）" },
                serial: { type: "integer", description: "执行窗格 #N（可选）" },
              },
              required: ["title"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "steps"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_read",
      description: "读取当前活动任务的完整状态（步骤、退出码、尝试次数、是否暂停）。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "任务 id；省略=当前活动任务" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_update_step",
      description: "更新任务步骤状态（done/failed/skipped/running），附结论摘要。",
      parameters: {
        type: "object",
        properties: {
          step: { type: "integer", description: "步骤序号（1 起）" },
          status: {
            type: "string",
            enum: ["pending", "running", "done", "failed", "skipped"],
          },
          result_summary: { type: "string", description: "一句话结论（建议填写）" },
          task_id: { type: "string", description: "省略=当前活动任务" },
        },
        required: ["step", "status"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_add_steps",
      description: "向现有任务追加步骤（任务完成态会重新打开）。",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                command: { type: "string" },
                serial: { type: "integer" },
              },
              required: ["title"],
              additionalProperties: false,
            },
          },
          task_id: { type: "string", description: "省略=当前活动任务" },
        },
        required: ["steps"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "app_settings",
      description:
        "调整应用设置（写入 ~/.aether/config.json，以文件为准）：主题、不透明度、Agent 执行模式、字号、上下文范围、AI 提供方/端点/API Key/模型等。可完整操作配置。",
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
          ai_api_key: {
            type: "string",
            description: "AI API Key（写入 config.json；传空字符串清空）",
          },
          ai_endpoint: {
            type: "string",
            description: "AI 接口端点 URL",
          },
          ai_provider: {
            type: "string",
            enum: ["openai-compat", "anthropic", "custom"],
            description: "AI 提供方",
          },
          ai_default_model_id: {
            type: "string",
            description: "默认模型 id",
          },
          ai_enabled: { type: "boolean", description: "AI 功能总开关" },
          font_size: { type: "integer", description: "终端字号 11–20" },
          context_scope: {
            type: "string",
            enum: ["focus", "activeTab", "allTabs"],
          },
          ai_open: {
            type: "boolean",
            description: "是否打开 Agent 面板",
          },
          font_family: { type: "string", description: "终端字体族名" },
          cursor_style: {
            type: "string",
            enum: ["bar", "block", "underline"],
            description: "光标形状",
          },
          cursor_blink: { type: "boolean", description: "光标是否闪烁" },
          accent_hue: { type: "integer", description: "主题强调色相 0–360" },
          shell_integration: {
            type: "boolean",
            description: "Shell 集成（命令块 OSC 133）",
          },
          notify_on_long_command: {
            type: "boolean",
            description: "长命令完成时系统通知",
          },
          notify_threshold_sec: {
            type: "integer",
            description: "长命令通知阈值（秒）",
          },
          suggest_enabled: { type: "boolean", description: "命令联想开关" },
          suggest_max: { type: "integer", description: "联想候选上限 3–12" },
          history_limit: { type: "integer", description: "历史保留条数" },
          restore_session: { type: "boolean", description: "启动恢复上次会话" },
          ai_on_start: { type: "boolean", description: "启动即显示 Agent 面板" },
          confirm_multi_tab_close: {
            type: "boolean",
            description: "关多标签窗口时确认",
          },
          project_context: {
            type: "boolean",
            description: "注入 AETHER.md 项目上下文",
          },
          output_snapshot_enabled: {
            type: "boolean",
            description: "恢复时回填终端输出快照",
          },
          output_snapshot_lines: {
            type: "integer",
            description: "输出快照行数",
          },
          context_lines: { type: "integer", description: "发给模型的上下文行数" },
          include_draft: { type: "boolean", description: "上下文包含未提交输入" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "app_query",
      description:
        "只读查询应用当前状态（不修改任何东西）。改设置/加主机前先用它了解现状。",
      parameters: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            enum: [
              "settings",
              "mcp",
              "hosts",
              "snippets",
              "approval",
              "recording",
              "broadcast",
              "extensions",
            ],
            description: "要查询的领域",
          },
        },
        required: ["domain"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mcp_manage",
      description:
        "管理 MCP server：注册/连接/启停/删除。连接后其工具以 mcp__名称__工具 加入工具表。注册 stdio 会启动本地进程（配置即执行），需用户确认。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "add",
              "connect",
              "disconnect",
              "enable",
              "disable",
              "delete",
            ],
          },
          name: { type: "string", description: "server 名称（add / 定位用）" },
          transport: { type: "string", enum: ["stdio", "http"] },
          command_line: {
            type: "string",
            description: "stdio 启动命令行，如 npx -y @modelcontextprotocol/server-filesystem D:\\proj",
          },
          url: { type: "string", description: "http transport 的 URL" },
          env: {
            type: "string",
            description: "环境变量，每行 KEY=VALUE（可空）",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hosts_manage",
      description:
        "管理 SSH 主机：添加/连接（新标签）/删除。私钥按路径引用、只存本机、不外传。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "connect", "delete"] },
          name: { type: "string", description: "主机显示名（定位/新建用）" },
          host: { type: "string", description: "主机地址 / IP" },
          port: { type: "integer" },
          user: { type: "string" },
          identity_file: { type: "string", description: "私钥路径（可空）" },
          jump_host: { type: "string", description: "跳板 -J（可空）" },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "snippet_manage",
      description:
        "管理命令片段：新增/运行/删除。运行会把模板参数填好后写入焦点窗格（受命令危险策略约束）。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "run", "delete"] },
          name: { type: "string", description: "片段名称（定位/新建用）" },
          template: {
            type: "string",
            description: "命令模板，参数用 {name} 占位（add）",
          },
          values: {
            type: "object",
            description: "运行时的参数取值 {参数名: 值}（run）",
            additionalProperties: { type: "string" },
          },
          serial: { type: "integer", description: "运行目标窗格（省略=焦点）" },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recording",
      description: "asciinema 录制当前/指定窗格：开始/停止。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "stop"] },
          serial: { type: "integer", description: "目标窗格（省略=焦点）" },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "broadcast",
      description:
        "广播输入：把键盘输入同时发到多个窗格。on=开启（指定 serials 或当前标签全部），off=全部关闭。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["on", "off"] },
          serials: {
            type: "array",
            items: { type: "integer" },
            description: "on 时的目标窗格序号；省略=当前标签所有窗格",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skill_manage",
      description:
        "创建/更新/删除内置 Skill（写入 ~/.aether/skills/<id>/SKILL.md）。用户说「帮我建一个 skill / 记住这个操作流程」时用它。写入后下一轮生效。按 skill-creator 写法：触发条件+步骤+边界。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["write", "delete"] },
          id: {
            type: "string",
            description: "kebab-case 唯一 id（小写字母/数字/连字符），即目录名",
          },
          title: { type: "string", description: "中文短名（write 时建议）" },
          category: {
            type: "string",
            description: "归类：基础/应用/集成/效率/交互/元…（write 时建议）",
          },
          summary: {
            type: "string",
            description: "一句话简介，用于设置页列表（write 时建议）",
          },
          body: {
            type: "string",
            description: "Skill 正文（markdown）；write 时必填：触发条件+步骤+边界",
          },
        },
        required: ["action", "id"],
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

  // ── 1.0 统一审批入口：内置工具 / run_command / MCP 全走这里 ──
  const { resolveApproval, addRule, escapeGlob } = await import("./approval");
  const { askApproval } = await import("../components/AppDialog");
  const isMcp = name.startsWith("mcp__");
  const mcpServer = isMcp ? name.split("__")[1] : undefined;
  const approvalCmd = name === "run_command" ? String(args.command || "") : undefined;
  const verdict = resolveApproval({ tool: name, command: approvalCmd, mcpServer });
  /** User explicitly consented via dialog — overrides danger-insert downgrade */
  let approvedViaDialog = false;
  if (verdict.decision === "deny") {
    return { ok: false, result: `已被审批规则拒绝（${verdict.reason}）` };
  }
  if (verdict.decision === "ask") {
    const detail =
      approvalCmd ??
      (argsJson && argsJson !== "{}" ? argsJson.slice(0, 600) : "（无参数）");
    const ans = await askApproval(
      isMcp
        ? `Agent 想调用 MCP 工具 ${name.replace(/^mcp__[^_]+__/, "")}`
        : name === "run_command"
          ? "Agent 想执行命令"
          : `Agent 想使用工具 ${name}`,
      {
        message: verdict.dangerous
          ? `⚠ 命中危险命令规则 · ${verdict.reason}`
          : verdict.reason,
        detail,
        danger: verdict.dangerous,
      },
    );
    if (ans === "deny") {
      return { ok: false, result: "用户拒绝了此操作。请换一种方式或询问用户。" };
    }
    if (ans === "always") {
      if (name === "run_command" && approvalCmd) {
        // Escape glob metachars so "总是允许 X" matches command X *exactly* —
        // a benign command containing * / ? must not widen into a wildcard rule.
        addRule({ scope: "command-pattern", key: escapeGlob(approvalCmd.trim()), decision: "allow" });
      } else if (isMcp && mcpServer) {
        addRule({ scope: "mcp-server", key: mcpServer, decision: "allow" });
      } else {
        addRule({ scope: "tool", key: name, decision: "allow" });
      }
    }
    approvedViaDialog = true;
  }

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
    const waitForExit = args.wait_for_exit === true || args.wait_for_exit === "true";
    const waitMs = waitForExit
      ? Math.min(300_000, Math.max(3000, Number(args.wait_ms) || 120_000))
      : Math.min(12000, Math.max(800, Number(args.wait_ms) || 2500));

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

    // Shared policy with the store path (resolveDangerAction) — channels must
    // agree. Explicit dialog approval overrides the danger-insert downgrade
    // (the user just saw the full command and said run), but never execMode=insert.
    let decision = resolveDangerAction(command, settings, true);
    if (
      approvedViaDialog &&
      decision.note === "danger-insert" &&
      settings.execMode !== "insert"
    ) {
      decision = { ...decision, run: true, note: "" };
    }
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

    // ── wait_for_exit：block-driven（0.9 任务自治核心）──
    if (waitForExit) {
      const { lastBlock, readBlockOutput, formatDuration } = await import(
        "./commandBlocks"
      );
      const { getLiveTerm } = await import("../features/terminal/termRegistry");
      const t0 = Date.now();
      const deadline = t0 + waitMs;
      // Give the shell ~4s to emit the C-mark; no block → integration inactive
      let blockSeen = false;
      while (Date.now() < deadline) {
        await sleep(300);
        const b = lastBlock(leafId);
        if (b && b.startedAt >= t0 - 1500) {
          blockSeen = true;
          if (!b.running) {
            const live = getLiveTerm(leafId);
            const out = live ? readBlockOutput(live.term, b, 80) : null;
            const dur = formatDuration((b.endedAt ?? Date.now()) - b.startedAt);
            return {
              ok: true,
              result: [
                `已在 #${leaf.serial} 执行并等到结束: ${command}`,
                `exitCode=${b.exitCode ?? "?"} · 耗时 ${dur}`,
                "--- 输出 ---",
                redactAndTrimContext(out || "（无输出）", 4000),
              ].join("\n"),
            };
          }
        } else if (!blockSeen && Date.now() - t0 > 4000) {
          break; // no shell integration → snapshot fallback below
        }
      }
      if (blockSeen) {
        // Command still running at timeout — report honestly, let model decide
        const out = getPaneOutput(leafId, 40);
        return {
          ok: true,
          result: `已在 #${leaf.serial} 执行: ${command}\n[超时 ${Math.round(waitMs / 1000)}s 命令仍在运行 · exitCode=null] 可稍后 read_pane blocks=true 查看结果。\n--- 当前输出尾部 ---\n${redactAndTrimContext(out || "（暂无输出）", 2000)}`,
        };
      }
      // Degrade: no OSC 133 (cmd/未注入) — snapshot semantics, unreliable
      await sleep(2000);
      const out = getPaneOutput(leafId, 60);
      return {
        ok: true,
        result: `已在 #${leaf.serial} 执行: ${command}\n[该窗格无命令块（Shell 集成不可用），退出码未知，以下快照结果不可靠]\n--- 输出 ---\n${redactAndTrimContext(out || "（暂无输出）", 4000)}`,
      };
    }

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

  if (
    name === "task_create" ||
    name === "task_read" ||
    name === "task_update_step" ||
    name === "task_add_steps"
  ) {
    const tasksLib = await import("./agentTasks");

    const parseSteps = (
      raw: unknown,
    ): Array<{ title: string; command?: string; targetSerial?: number }> => {
      if (!Array.isArray(raw)) return [];
      return raw
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          const title = String(o.title || "").trim();
          if (!title) return null;
          return {
            title,
            command: o.command ? String(o.command) : undefined,
            targetSerial:
              o.serial != null && o.serial !== "" ? Number(o.serial) : undefined,
          };
        })
        .filter(Boolean) as Array<{
        title: string;
        command?: string;
        targetSerial?: number;
      }>;
    };

    if (name === "task_create") {
      const title = String(args.title || "").trim();
      const steps = parseSteps(args.steps);
      if (!title) return { ok: false, result: "缺少 title" };
      if (!steps.length) return { ok: false, result: "steps 为空或格式不对" };
      const task = tasksLib.createTask(
        title,
        steps,
        st.activeAgentSessionId ?? undefined,
      );
      return {
        ok: true,
        result: `已创建任务并设为活动：\n${tasksLib.formatTaskState(task)}`,
      };
    }

    const taskId = args.task_id ? String(args.task_id) : null;
    const task = taskId
      ? tasksLib.getTask(taskId)
      : tasksLib.getActiveTask();
    if (!task) {
      return {
        ok: false,
        result: taskId ? `任务 ${taskId} 不存在` : "当前没有活动任务（可 task_create）",
      };
    }

    if (name === "task_read") {
      return { ok: true, result: tasksLib.formatTaskState(task) };
    }

    if (name === "task_update_step") {
      const idx = Number(args.step);
      if (!Number.isFinite(idx) || idx < 1 || idx > task.steps.length) {
        return {
          ok: false,
          result: `step 序号无效（1–${task.steps.length}）`,
        };
      }
      const status = String(args.status) as
        | "pending"
        | "running"
        | "done"
        | "failed"
        | "skipped";
      if (!["pending", "running", "done", "failed", "skipped"].includes(status)) {
        return { ok: false, result: "status 无效" };
      }
      const step = task.steps[idx - 1];
      const patch: Record<string, unknown> = { status };
      if (args.result_summary != null) {
        patch.resultSummary = String(args.result_summary).slice(0, 200);
      }
      if (status === "running") {
        patch.attempts = (step.attempts ?? 0) + 1;
      }
      const updated = tasksLib.updateStep(task.id, step.id, patch);
      return {
        ok: true,
        result: updated
          ? `已更新步骤 ${idx} → ${status}${updated.status === "done" ? " · 任务全部完成 ✓" : ""}`
          : "更新失败",
      };
    }

    // task_add_steps
    const steps = parseSteps(args.steps);
    if (!steps.length) return { ok: false, result: "steps 为空或格式不对" };
    const updated = tasksLib.addSteps(task.id, steps);
    return {
      ok: true,
      result: updated
        ? `已追加 ${steps.length} 步：\n${tasksLib.formatTaskState(updated)}`
        : "追加失败",
    };
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
      const v = String(args.exec_mode ?? args.execMode);
      if (["insert", "confirm", "auto"].includes(v)) {
        patch.execMode = v as "insert" | "confirm" | "auto";
        notes.push(`执行方式=${v}`);
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
    if (args.accent_hue != null || args.accentHue != null) {
      const n = Math.round(Number(args.accent_hue ?? args.accentHue));
      if (Number.isFinite(n)) {
        const hue = ((n % 360) + 360) % 360;
        patch.accentHue = hue;
        notes.push(`色相=${hue}`);
      }
    }
    if (args.cursor_style != null || args.cursorStyle != null) {
      const v = String(args.cursor_style ?? args.cursorStyle);
      if (["bar", "block", "underline"].includes(v)) {
        patch.cursorStyle = v as "bar" | "block" | "underline";
        notes.push(`光标=${v}`);
      }
    }
    // Plain string / boolean / clamped-int fields the agent may safely set.
    const strFields: Record<string, string> = {
      font_family: "fontFamily",
      fontFamily: "fontFamily",
    };
    for (const [k, field] of Object.entries(strFields)) {
      if (args[k] != null && typeof args[k] === "string") {
        const val = String(args[k]).slice(0, 80);
        patch[field] = val;
        notes.push(`${field}=${val}`);
      }
    }
    const boolFields: Record<string, string> = {
      cursor_blink: "cursorBlink",
      shell_integration: "shellIntegration",
      notify_on_long_command: "notifyOnLongCommand",
      suggest_enabled: "suggestEnabled",
      restore_session: "restoreSession",
      ai_on_start: "aiOnStart",
      confirm_multi_tab_close: "confirmMultiTabClose",
      project_context: "projectContext",
      output_snapshot_enabled: "outputSnapshotEnabled",
      include_draft: "includeDraft",
    };
    for (const [k, field] of Object.entries(boolFields)) {
      if (args[k] != null) {
        (patch as Record<string, unknown>)[field] = Boolean(args[k]);
        notes.push(`${field}=${patch[field] ? "开" : "关"}`);
      }
    }
    const intFields: Record<string, { field: string; min: number; max: number }> = {
      notify_threshold_sec: { field: "notifyThresholdSec", min: 1, max: 3600 },
      suggest_max: { field: "suggestMax", min: 3, max: 12 },
      history_limit: { field: "historyLimit", min: 50, max: 10000 },
      output_snapshot_lines: { field: "outputSnapshotLines", min: 50, max: 5000 },
      context_lines: { field: "contextLines", min: 10, max: 2000 },
    };
    for (const [k, spec] of Object.entries(intFields)) {
      if (args[k] != null) {
        const n = Math.min(spec.max, Math.max(spec.min, Math.round(Number(args[k]))));
        if (Number.isFinite(n)) {
          (patch as Record<string, unknown>)[spec.field] = n;
          notes.push(`${spec.field}=${n}`);
        }
      }
    }
    // AI provider config — the agent may fully operate config.json (per product
    // owner's explicit choice). Written to ~/.aether/config.json like everything
    // else; export/share still scrubs the key via exportSettingsJson().
    if (args.ai_api_key != null || args.aiApiKey != null) {
      const v = String(args.ai_api_key ?? args.aiApiKey);
      patch.aiApiKey = v;
      notes.push(`API Key=${v ? "已更新" : "已清空"}`);
    }
    if (args.ai_endpoint != null || args.aiEndpoint != null) {
      const v = String(args.ai_endpoint ?? args.aiEndpoint).slice(0, 500);
      patch.aiEndpoint = v;
      notes.push(`端点=${v || "已清空"}`);
    }
    if (args.ai_provider != null || args.aiProvider != null) {
      const v = String(args.ai_provider ?? args.aiProvider);
      if (["openai-compat", "anthropic", "custom"].includes(v)) {
        patch.aiProvider = v as "openai-compat" | "anthropic" | "custom";
        notes.push(`提供方=${v}`);
      }
    }
    if (args.ai_default_model_id != null || args.aiDefaultModelId != null) {
      const v = String(args.ai_default_model_id ?? args.aiDefaultModelId).slice(0, 120);
      patch.aiDefaultModelId = v;
      notes.push(`默认模型=${v || "已清空"}`);
    }
    if (args.ai_enabled != null || args.aiEnabled != null) {
      patch.aiEnabled = Boolean(args.ai_enabled ?? args.aiEnabled);
      notes.push(`AI=${patch.aiEnabled ? "开" : "关"}`);
    }
    if (Object.keys(patch).length) {
      settings.patch(patch as Partial<typeof settings>);
      settings.applyAccent();
    }
    if (!notes.length) {
      return {
        ok: false,
        result:
          "未提供可改字段。可用: theme, opacity, font_size, context_scope, ai_open, font_family, cursor_style, cursor_blink, accent_hue, shell_integration, notify_on_long_command, notify_threshold_sec, suggest_enabled, suggest_max, history_limit, restore_session, ai_on_start, confirm_multi_tab_close, project_context, output_snapshot_enabled, output_snapshot_lines, context_lines, include_draft",
      };
    }
    return { ok: true, result: `已更新: ${notes.join(" · ")}` };
  }

  if (name === "app_query") {
    const domain = String(args.domain || "");
    if (domain === "settings") {
      const s = settings;
      const view = {
        themePreset: s.themePreset,
        accentHue: s.accentHue,
        uiOpacity: s.uiOpacity,
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        cursorStyle: s.cursorStyle,
        cursorBlink: s.cursorBlink,
        execMode: s.execMode,
        confirmDanger: s.confirmDanger,
        contextScope: s.contextScope,
        contextLines: s.contextLines,
        includeDraft: s.includeDraft,
        shellIntegration: s.shellIntegration,
        notifyOnLongCommand: s.notifyOnLongCommand,
        notifyThresholdSec: s.notifyThresholdSec,
        suggestEnabled: s.suggestEnabled,
        suggestMax: s.suggestMax,
        historyLimit: s.historyLimit,
        restoreSession: s.restoreSession,
        aiOnStart: s.aiOnStart,
        aiEnabled: s.aiEnabled,
        projectContext: s.projectContext,
        aiProvider: s.aiProvider,
        aiEndpoint: s.aiEndpoint,
        aiDefaultModelId: s.aiDefaultModelId,
        aiApiKey: s.aiApiKey ? "（已设置）" : "（空）",
        defaultShell: s.defaultShell,
        outputSnapshotEnabled: s.outputSnapshotEnabled,
        outputSnapshotLines: s.outputSnapshotLines,
      };
      return { ok: true, result: JSON.stringify(view, null, 2) };
    }
    if (domain === "mcp") {
      const { loadMcpServers, getConnectedTools } = await import("./mcp");
      const rows = loadMcpServers().map((m) => {
        const t = getConnectedTools(m.id);
        const target =
          m.transport === "http" ? m.url : `${m.command} ${(m.args ?? []).join(" ")}`;
        return `${m.enabled ? "✓启用" : "○停用"} ${m.name} [${m.transport}] ${
          t ? `已连接·${t.length}工具` : "未连接"
        } — ${target}`;
      });
      return { ok: true, result: rows.length ? rows.join("\n") : "（无 MCP server）" };
    }
    if (domain === "hosts") {
      const { loadSshHosts, buildSshArgs } = await import("./sshHosts");
      const rows = loadSshHosts().map((h) => `${h.name} — ssh ${buildSshArgs(h).join(" ")}`);
      return { ok: true, result: rows.length ? rows.join("\n") : "（无 SSH 主机）" };
    }
    if (domain === "snippets") {
      const { loadSnippets } = await import("./snippets");
      const rows = loadSnippets().map(
        (sn) => `${sn.name}${sn.shellKeys?.length ? ` [${sn.shellKeys.join("/")}]` : ""} — ${sn.template}`,
      );
      return { ok: true, result: rows.length ? rows.join("\n") : "（无片段）" };
    }
    if (domain === "approval") {
      const { loadApproval, PRESET_LABELS } = await import("./approval");
      const a = loadApproval();
      const rules = a.rules.map((r) => `${r.decision} · ${r.scope} · ${r.key}`);
      return {
        ok: true,
        result: `预设: ${PRESET_LABELS[a.preset]}\n规则（${a.rules.length}）:\n${
          rules.length ? rules.join("\n") : "（无）"
        }`,
      };
    }
    if (domain === "recording") {
      const { recordStatus } = await import("./recording");
      const rows: string[] = [];
      for (const t of listLiveTerms()) {
        const on = await recordStatus(t.ptyId).catch(() => false);
        const leaf = (() => {
          for (const tab of st.tabs) {
            const L = collectLeaves(tab.layout).find((x) => x.id === t.paneId);
            if (L) return L;
          }
          return null;
        })();
        rows.push(`#${leaf?.serial ?? "?"} ${on ? "● 录制中" : "○ 未录制"}`);
      }
      return { ok: true, result: rows.length ? rows.join("\n") : "（无活动窗格）" };
    }
    if (domain === "broadcast") {
      const ids = new Set(st.broadcastPanes);
      const serials: number[] = [];
      for (const tab of st.tabs) {
        for (const L of collectLeaves(tab.layout)) if (ids.has(L.id)) serials.push(L.serial);
      }
      return {
        ok: true,
        result: serials.length ? `广播开启中: ${serials.map((n) => `#${n}`).join(" ")}` : "广播未开启",
      };
    }
    if (domain === "extensions") {
      const { loadExtensions, enabledExtensions } = await import("./extensions");
      const on = new Set(enabledExtensions().map((e) => e.id));
      const rows = loadExtensions().map((e) => `${on.has(e.id) ? "✓" : "○"} ${e.name}`);
      return { ok: true, result: rows.length ? rows.join("\n") : "（无扩展）" };
    }
    return { ok: false, result: `未知 domain: ${domain}` };
  }

  if (name === "mcp_manage") {
    const {
      loadMcpServers,
      upsertMcpServer,
      connectMcpServer,
      disconnectMcpServer,
      deleteMcpServer,
      newMcpServerId,
    } = await import("./mcp");
    const action = String(args.action || "");
    const findByName = (nm: string) =>
      loadMcpServers().find((m) => m.name === nm);

    if (action === "add") {
      const nm = String(args.name || "").trim();
      if (!nm) return { ok: false, result: "缺少 name" };
      const transport = args.transport === "http" ? "http" : "stdio";
      const parts =
        String(args.command_line || "").match(/"[^"]*"|\S+/g)?.map((p) => p.replace(/^"|"$/g, "")) ?? [];
      const command = parts[0] ?? "";
      const cmdArgs = parts.slice(1);
      const url = String(args.url || "").trim();
      if (transport === "stdio" && !command) return { ok: false, result: "stdio 需要 command_line" };
      if (transport === "http" && !url) return { ok: false, result: "http 需要 url" };
      const env: Record<string, string> = {};
      for (const line of String(args.env || "").split(/\r?\n/)) {
        const i = line.indexOf("=");
        if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      // 防"配置即执行"：注册 stdio 会启动本地进程，二次确认命令行
      if (transport === "stdio") {
        const ok = await askApproval("Agent 想注册 MCP（将启动本地进程）", {
          message: "配置即执行：确认这是你信任的程序",
          detail: `${command} ${cmdArgs.join(" ")}`,
          danger: true,
        });
        if (ok === "deny") return { ok: false, result: "用户拒绝了 MCP 注册。" };
      }
      const existing = findByName(nm);
      upsertMcpServer({
        id: existing?.id ?? newMcpServerId(),
        name: nm,
        transport,
        command,
        args: cmdArgs,
        env,
        url,
        enabled: true,
      });
      return { ok: true, result: `已${existing ? "更新" : "注册"} MCP「${nm}」（可 connect 测试）` };
    }
    const target = findByName(String(args.name || "").trim());
    if (!target) return { ok: false, result: `未找到 MCP server「${args.name}」` };
    if (action === "connect") {
      try {
        const tools = await connectMcpServer(target);
        return { ok: true, result: `已连接「${target.name}」· ${tools.length} 个工具` };
      } catch (e) {
        return { ok: false, result: `连接失败: ${e instanceof Error ? e.message : e}` };
      }
    }
    if (action === "disconnect") {
      await disconnectMcpServer(target.id);
      return { ok: true, result: `已断开「${target.name}」` };
    }
    if (action === "enable" || action === "disable") {
      const enabled = action === "enable";
      upsertMcpServer({ ...target, enabled });
      if (!enabled) await disconnectMcpServer(target.id);
      return { ok: true, result: `已${enabled ? "启用" : "停用"}「${target.name}」` };
    }
    if (action === "delete") {
      await disconnectMcpServer(target.id);
      deleteMcpServer(target.id);
      return { ok: true, result: `已删除「${target.name}」` };
    }
    return { ok: false, result: `未知 action: ${action}` };
  }

  if (name === "hosts_manage") {
    const { loadSshHosts, upsertSshHost, newSshHostId } = await import("./sshHosts");
    const action = String(args.action || "");
    const findByName = (nm: string) => loadSshHosts().find((h) => h.name === nm);

    if (action === "add") {
      const nm = String(args.name || "").trim();
      const host = String(args.host || "").trim();
      if (!nm || !host) return { ok: false, result: "缺少 name 或 host" };
      const port = Number(args.port);
      const existing = findByName(nm);
      upsertSshHost({
        id: existing?.id ?? newSshHostId(),
        name: nm,
        host,
        port: Number.isFinite(port) && port > 0 ? port : undefined,
        user: String(args.user || "").trim() || undefined,
        identityFile: String(args.identity_file || "").trim() || undefined,
        jumpHost: String(args.jump_host || "").trim() || undefined,
        extraArgs: [],
      });
      return { ok: true, result: `已${existing ? "更新" : "添加"}主机「${nm}」` };
    }
    const target = findByName(String(args.name || "").trim());
    if (!target) return { ok: false, result: `未找到主机「${args.name}」` };
    if (action === "delete") {
      const { deleteSshHost } = await import("./sshHosts");
      deleteSshHost(target.id);
      return { ok: true, result: `已删除主机「${target.name}」` };
    }
    if (action === "connect") {
      const { useShellCatalogStore } = await import("../store/shellCatalogStore");
      const profileId = `ssh:${target.id}`;
      let profile = useShellCatalogStore.getState().profiles.find((p) => p.id === profileId);
      if (!profile) {
        await useShellCatalogStore.getState().scan();
        profile = useShellCatalogStore.getState().profiles.find((p) => p.id === profileId);
      }
      if (!profile) return { ok: false, result: "未能生成 SSH profile（请检查主机配置）" };
      st.createTabFromProfile(profile);
      return { ok: true, result: `正在连接「${target.name}」（新标签）` };
    }
    return { ok: false, result: `未知 action: ${action}` };
  }

  if (name === "snippet_manage") {
    const { loadSnippets, upsertSnippet, newSnippetId, extractParams, renderSnippet } =
      await import("./snippets");
    const action = String(args.action || "");
    const findByName = (nm: string) => loadSnippets().find((s) => s.name === nm);

    if (action === "add") {
      const nm = String(args.name || "").trim();
      const template = String(args.template || "");
      if (!nm || !template.trim()) return { ok: false, result: "缺少 name 或 template" };
      const existing = findByName(nm);
      upsertSnippet({
        id: existing?.id ?? newSnippetId(),
        name: nm,
        template,
        params: extractParams(template).map((n) => ({ name: n })),
        shellKeys: [],
        tags: [],
      });
      return { ok: true, result: `已${existing ? "更新" : "新增"}片段「${nm}」` };
    }
    const target = findByName(String(args.name || "").trim());
    if (!target) return { ok: false, result: `未找到片段「${args.name}」` };
    if (action === "delete") {
      const { deleteSnippet } = await import("./snippets");
      deleteSnippet(target.id);
      return { ok: true, result: `已删除片段「${target.name}」` };
    }
    if (action === "run") {
      const values = (args.values && typeof args.values === "object"
        ? (args.values as Record<string, string>)
        : {});
      const command = renderSnippet(target, values).trim();
      if (!command) return { ok: false, result: "渲染后为空命令" };
      const serial =
        args.serial != null && args.serial !== ""
          ? Number(args.serial)
          : st.activePane()?.serial;
      const leaf = serial != null ? st.resolveSerial(serial) : st.activePane();
      if (!leaf) return { ok: false, result: `目标窗格不存在 (#${serial ?? "焦点"})` };
      const ptyId = getLivePtyId(leaf.id) || leaf.ptyId || null;
      if (!ptyId) return { ok: false, result: `窗格 #${leaf.serial} 无 live PTY，请先点一下该窗格` };
      st.setActivePane(leaf.id);
      const decision = resolveDangerAction(command, settings, true);
      if (!decision.run) {
        await ptyWrite(ptyId, command);
        return {
          ok: false,
          result: `危险/确认模式：片段命令已仅插入 #${leaf.serial} 未回车: ${command}`,
        };
      }
      await ptyWrite(ptyId, `${command}\r`);
      const { recordCommand } = await import("./commandHistory");
      recordCommand(command, leaf.shellKey, settings.historyLimit);
      st.notePaneCommand(leaf.id, command);
      return { ok: true, result: `已运行片段「${target.name}」于 #${leaf.serial}: ${command}` };
    }
    return { ok: false, result: `未知 action: ${action}` };
  }

  if (name === "recording") {
    const action = String(args.action || "");
    const serial =
      args.serial != null && args.serial !== ""
        ? Number(args.serial)
        : st.activePane()?.serial;
    const leaf = serial != null ? st.resolveSerial(serial) : st.activePane();
    if (!leaf) return { ok: false, result: `目标窗格不存在 (#${serial ?? "焦点"})` };
    const ptyId = getLivePtyId(leaf.id) || leaf.ptyId || null;
    if (!ptyId) return { ok: false, result: `窗格 #${leaf.serial} 无 live PTY` };
    const { recordStart, recordStop } = await import("./recording");
    try {
      if (action === "start") {
        const path = await recordStart(ptyId);
        return { ok: true, result: `已开始录制 #${leaf.serial} → ${path}` };
      }
      if (action === "stop") {
        const path = await recordStop(ptyId);
        return { ok: true, result: path ? `已停止录制 #${leaf.serial} → ${path}` : `#${leaf.serial} 未在录制` };
      }
    } catch (e) {
      return { ok: false, result: `录制失败: ${e instanceof Error ? e.message : e}` };
    }
    return { ok: false, result: `未知 action: ${action}` };
  }

  if (name === "broadcast") {
    const action = String(args.action || "");
    if (action === "off") {
      st.clearBroadcast();
      return { ok: true, result: "已关闭广播输入" };
    }
    if (action === "on") {
      const wanted: string[] = [];
      const serialsArg = Array.isArray(args.serials) ? (args.serials as unknown[]) : null;
      if (serialsArg && serialsArg.length) {
        for (const s of serialsArg) {
          const leaf = st.resolveSerial(Number(s));
          if (leaf) wanted.push(leaf.id);
        }
      } else {
        const tab = st.activeTab();
        if (tab) for (const L of collectLeaves(tab.layout)) wanted.push(L.id);
      }
      if (wanted.length < 2) {
        return { ok: false, result: "广播至少需要 2 个窗格（当前不足）" };
      }
      const current = new Set(st.broadcastPanes);
      for (const id of wanted) if (!current.has(id)) st.toggleBroadcastPane(id);
      const serials = wanted.map((id) => {
        for (const tab of st.tabs) {
          const L = collectLeaves(tab.layout).find((x) => x.id === id);
          if (L) return `#${L.serial}`;
        }
        return "#?";
      });
      return { ok: true, result: `已对 ${serials.join(" ")} 开启广播输入` };
    }
    return { ok: false, result: `未知 action: ${action}` };
  }

  if (name === "skill_manage") {
    const { writeSkill, deleteSkill } = await import("./agentSkills");
    const action = String(args.action || "");
    const id = String(args.id || "").trim();
    if (!id) return { ok: false, result: "缺少 skill id" };
    try {
      if (action === "delete") {
        await deleteSkill(id);
        return { ok: true, result: `已删除 skill「${id}」（下一轮生效）` };
      }
      if (action === "write") {
        const body = String(args.body ?? "").trim();
        if (!body) return { ok: false, result: "write 需要 body（Skill 正文）" };
        const path = await writeSkill({
          id,
          title: args.title != null ? String(args.title) : undefined,
          category: args.category != null ? String(args.category) : undefined,
          summary: args.summary != null ? String(args.summary) : undefined,
          body,
        });
        return { ok: true, result: `已写入 ${path}（下一轮对话生效）` };
      }
      return { ok: false, result: `未知 action: ${action}` };
    } catch (e) {
      return { ok: false, result: `Skill 操作失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ── MCP tools (1.0): mcp__<server>__<tool> → Rust runtime ──
  if (isMcp) {
    const { buildMcpToolTable, callMcpTool } = await import("./mcp");
    const binding = buildMcpToolTable().bindings.get(name);
    if (!binding) {
      return { ok: false, result: `MCP 工具 ${name} 未连接（server 可能已停用）` };
    }
    try {
      const out = await callMcpTool(binding.serverId, binding.tool, args);
      return { ok: true, result: out || "（空结果）" };
    } catch (e) {
      return {
        ok: false,
        result: `MCP 调用失败: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
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

  // MCP tools join the table for every round (broken servers skipped silently)
  let allTools: unknown[] = [...AGENT_TOOLS_OPENAI];
  try {
    const { ensureMcpConnected, buildMcpToolTable } = await import("./mcp");
    await ensureMcpConnected();
    const { tools: mcpTools } = buildMcpToolTable();
    if (mcpTools.length) allTools = [...AGENT_TOOLS_OPENAI, ...mcpTools];
  } catch {
    /* MCP unavailable → built-ins only */
  }

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

    const res = await round(allTools);

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
