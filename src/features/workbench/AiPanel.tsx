import { useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useSettingsStore } from "../../store/settingsStore";
import { buildContextBundle, localAgentReply } from "../../lib/agentLocal";
import { redactAndTrimContext } from "../../lib/contextRedact";
import { agentChat, agentChatCancel, agentModelsList } from "../../ipc/pty";
import { runAgentToolLoop } from "../../lib/agentToolLoop";
import { isTauri } from "../../lib/window";
import { nextId } from "../../lib/ids";
import { markdownToHtml } from "../../lib/markdown";
import {
  actionChipLabel,
  parseAgentActions,
  type AgentAction,
} from "../../lib/agentActions";
import { splitAgentReply } from "../../lib/agentReply";
import {
  createTask,
  formatActiveTaskPrompt,
  planFromText,
  setActiveTask,
} from "../../lib/agentTasks";
import { AGENT_BASE_PROMPT, formatAgentSkillsPrompt } from "../../lib/agentPrompt";
import { findLeaf } from "../../lib/layout";
import { TaskPanel } from "../agent/TaskPanel";
import {
  matchSlashCommands,
  slashEnterShouldAccept,
  type AgentSlashCommand,
} from "../../lib/agentSlash";
import { AppDialogHost, askConfirm } from "../../components/AppDialog";

/**
 * Effort maps to real API params since 0.7: reasoning_effort (OpenAI 兼容) /
 * thinking budget（Anthropic）。delay 仅用于浏览器 mock 的模拟延迟。
 */
const EFFORTS = [
  { id: "low" as const, label: "低 · 快", short: "低", delay: 220 },
  { id: "medium" as const, label: "中 · 均衡", short: "中", delay: 380 },
  { id: "high" as const, label: "高 · 深入", short: "高", delay: 620 },
  { id: "max" as const, label: "最高 · 最强", short: "最高", delay: 900 },
];

export function AiPanel() {
  const aiOpen = useWorkbenchStore((s) => s.aiOpen);
  const aiWidth = useWorkbenchStore((s) => s.aiWidth);
  const setAiWidth = useWorkbenchStore((s) => s.setAiWidth);
  const aiModel = useWorkbenchStore((s) => s.aiModel);
  const aiEffort = useWorkbenchStore((s) => s.aiEffort);
  const setAiModel = useWorkbenchStore((s) => s.setAiModel);
  const setAiEffort = useWorkbenchStore((s) => s.setAiEffort);
  const aiModels = useWorkbenchStore((s) => s.aiModels);
  const aiModelsStatus = useWorkbenchStore((s) => s.aiModelsStatus);
  const setAiModels = useWorkbenchStore((s) => s.setAiModels);
  // Only the serial is rendered; select the primitive so the panel doesn't
  // re-render on every cwd/draft mutation of the focused pane's leaf object.
  const paneSerial = useWorkbenchStore((s) => s.activePane()?.serial ?? null);
  const session = useWorkbenchStore((s) => s.getActiveAgentSession());
  const agentSessions = useWorkbenchStore((s) => s.agentSessions);
  const appendAgentMessage = useWorkbenchStore((s) => s.appendAgentMessage);
  const clearActiveAgentMessages = useWorkbenchStore((s) => s.clearActiveAgentMessages);
  const markActionsConsumed = useWorkbenchStore((s) => s.markActionsConsumed);
  const insertToPane = useWorkbenchStore((s) => s.insertToPane);
  const agentBusy = useWorkbenchStore((s) => s.agentBusy);
  const setAgentBusy = useWorkbenchStore((s) => s.setAgentBusy);
  const setAgentStreamId = useWorkbenchStore((s) => s.setAgentStreamId);
  const newAgentSession = useWorkbenchStore((s) => s.newAgentSession);
  const switchAgentSession = useWorkbenchStore((s) => s.switchAgentSession);
  // agentBusy already subscribed above
  const deleteAgentSession = useWorkbenchStore((s) => s.deleteAgentSession);
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);
  const settings = useSettingsStore();
  const showThinking = useSettingsStore((s) => s.showThinking);
  const patchSettings = useSettingsStore((s) => s.patch);

  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPanel, setMenuPanel] = useState<"root" | "model" | "effort">("root");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [tasksOpen, setTasksOpen] = useState(false);
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [streamPreview, setStreamPreview] = useState("");
  /** Throttled HTML for live markdown while streaming (raw text still in streamPreview). */
  const [streamHtml, setStreamHtml] = useState("");
  const [thinkingPreview, setThinkingPreview] = useState("");
  const [liveToolTrace, setLiveToolTrace] = useState<
    import("../../store/workbenchStore").AiToolTraceStep[]
  >([]);
  const [slashIdx, setSlashIdx] = useState(0);
  /** Expand thinking blocks by message id */
  const [thinkingOpen, setThinkingOpen] = useState<Record<string, boolean>>({});
  const messagesRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const mockTimerRef = useRef<number | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const streamAccRef = useRef("");
  const thinkingAccRef = useRef("");
  const streamHtmlTimerRef = useRef<number | null>(null);
  /** Prevent double finish/error messages for the same stream */
  const streamSettledRef = useRef(false);
  /** Session id at send time — replies must not follow UI session switch */
  const streamSessionRef = useRef<string | null>(null);

  const effortMeta = EFFORTS.find((e) => e.id === aiEffort) ?? EFFORTS[1];
  const modelLabel =
    aiModels.find((m) => m.id === aiModel)?.label ||
    aiModel ||
    settings.aiDefaultModelId ||
    "未选择模型";
  const triggerLabel = `${modelLabel.length > 16 ? modelLabel.slice(0, 14) + "…" : modelLabel} ${effortMeta.short}`;

  const slashMatches = useMemo(() => matchSlashCommands(input), [input]);
  const slashOpen = slashMatches.length > 0 && !agentBusy;

  useEffect(() => {
    setSlashIdx(0);
  }, [input, slashMatches.length]);

  // Esc closes in-panel floats (tasks / history)
  useEffect(() => {
    if (!tasksOpen && !historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setTasksOpen(false);
      setHistoryOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tasksOpen, historyOpen]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [session?.messages.length, agentBusy, streamPreview, streamHtml]);

  // Live markdown: re-render on a short throttle so incomplete fences / bold
  // update smoothly without running the converter on every token.
  useEffect(() => {
    if (!streamPreview) {
      if (streamHtmlTimerRef.current != null) {
        window.clearTimeout(streamHtmlTimerRef.current);
        streamHtmlTimerRef.current = null;
      }
      setStreamHtml("");
      return;
    }
    if (streamHtmlTimerRef.current != null) return;
    streamHtmlTimerRef.current = window.setTimeout(() => {
      streamHtmlTimerRef.current = null;
      setStreamHtml(markdownToHtml(streamAccRef.current || streamPreview));
    }, 48);
    return () => {
      if (streamHtmlTimerRef.current != null) {
        window.clearTimeout(streamHtmlTimerRef.current);
        streamHtmlTimerRef.current = null;
      }
    };
  }, [streamPreview]);

  useEffect(() => {
    const el = resizeRef.current;
    if (!el) return;
    let startX = 0;
    let startW = 0;
    const onMove = (ev: PointerEvent) => {
      const dx = startX - ev.clientX;
      setAiWidth(startW + dx);
    };
    const onUp = () => {
      el.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    const onDown = (ev: PointerEvent) => {
      ev.preventDefault();
      startX = ev.clientX;
      // Read the current width at drag start rather than closing over aiWidth,
      // so this effect doesn't re-register listeners on every width change.
      startW = useWorkbenchStore.getState().aiWidth;
      el.classList.add("dragging");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [setAiWidth]);

  const cleanupStream = () => {
    if (unlistenRef.current) {
      try {
        void unlistenRef.current();
      } catch {
        /* ignore */
      }
      unlistenRef.current = null;
    }
    if (mockTimerRef.current != null) {
      window.clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }
    if (streamHtmlTimerRef.current != null) {
      window.clearTimeout(streamHtmlTimerRef.current);
      streamHtmlTimerRef.current = null;
    }
    setStreamPreview("");
    setStreamHtml("");
    setThinkingPreview("");
    streamAccRef.current = "";
    thinkingAccRef.current = "";
    setAgentStreamId(null);
    setAgentBusy(false);
    streamSettledRef.current = true;
  };

  /** Return true only once per stream lifecycle (first settle wins). */
  const settleStream = (): boolean => {
    if (streamSettledRef.current) return false;
    streamSettledRef.current = true;
    return true;
  };

  const refreshModels = async () => {
    const endpoint = settings.aiEndpoint.trim().replace(/\/$/, "");
    if (!endpoint) {
      setAiModels([], "请先在设置中填写 API 端点");
      toastMsg("请先配置 API 端点");
      return;
    }
    if (!settings.aiApiKey.trim()) {
      setAiModels([], "请填写 API Key");
      toastMsg("请填写 API Key");
      return;
    }
    setAiModels(aiModels, "加载中…");
    try {
      const models = await agentModelsList(endpoint, settings.aiApiKey, settings.aiProvider);
      setAiModels(models, `已加载 ${models.length} 个 · 刚刚`);
      const keep =
        models.find((m) => m.id === settings.aiDefaultModelId) ||
        models.find((m) => m.id === aiModel) ||
        models[0];
      if (keep) setAiModel(keep.id);
      toastMsg(`已刷新模型列表 · ${models.length}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      setAiModels([], `失败：${msg}`);
      toastMsg(`无法加载模型：${msg}`);
    }
  };

  const finishAssistant = (
    acc: string,
    focusSerial: number,
    streamedThinking = "",
    sessionId?: string | null,
    toolTrace?: import("../../store/workbenchStore").AiToolTraceStep[],
  ) => {
    const raw = acc || "";
    const { thinking, answer } = splitAgentReply(raw, streamedThinking);
    // Parse actions from model JSON only (skills teach when to emit)
    let actions = parseAgentActions(raw);
    if (!actions.length && answer) {
      actions = parseAgentActions(answer);
    }
    actions = actions.map((a) => ({
      ...a,
      targetSerial: a.targetSerial ?? focusSerial,
    }));
    const display = answer.trim() || (thinking ? "（见上方思考；正文为空）" : "");
    if (!display && !thinking) {
      appendAgentMessage(
        {
          role: "assistant",
          content: "（空回复）",
          html: markdownToHtml(
            "模型返回了空内容。请确认端点为 `…/v1`、模型 id 正确，并完全重启客户端后再试。",
          ),
          toolTrace,
        },
        sessionId,
      );
      return;
    }
    const primary = actions.find((a) => a.command) || actions[0];
    appendAgentMessage(
      {
        role: "assistant",
        content: (display || thinking).slice(0, 240),
        html: display ? markdownToHtml(display) : undefined,
        thinking: thinking || undefined,
        toolTrace: toolTrace?.length ? toolTrace : undefined,
        actions: actions.length
          ? actions.map((a) => ({
              type: a.type,
              targetSerial: a.targetSerial ?? focusSerial,
              command: a.command,
              text: a.text,
              label: actionChipLabel(a),
            }))
          : undefined,
        cmd: primary?.command,
        targetSerial: primary?.targetSerial ?? focusSerial,
      },
      sessionId,
    );
  };

  /** Prior turns for multi-turn (cap chars / messages). */
  const buildChatHistory = (sessionId: string | null | undefined, maxMsgs = 12, maxChars = 8000) => {
    const sess = useWorkbenchStore
      .getState()
      .agentSessions.find((x) => x.id === sessionId);
    if (!sess?.messages.length) return [] as { role: string; content: string }[];
    const out: { role: string; content: string }[] = [];
    let budget = maxChars;
    const recent = sess.messages.filter((m) => m.role === "user" || m.role === "assistant").slice(-maxMsgs);
    for (const m of recent) {
      const content = (m.content || "").slice(0, 2000);
      if (!content.trim()) continue;
      if (content.length > budget) break;
      out.push({ role: m.role, content });
      budget -= content.length;
    }
    return out;
  };

  const lastAssistantId = useMemo(() => {
    const msgs = session?.messages;
    if (!msgs?.length) return null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") return msgs[i].id;
    }
    return null;
  }, [session?.messages]);

  const runAction = (a: AgentAction, messageId?: string) => {
    const st = useWorkbenchStore.getState();
    if (a.type === "reply") {
      const text = (a.text || a.command || "").trim();
      if (!text) {
        toastMsg("动作缺少回复内容");
        return;
      }
      // Busy: sendWithText would silently drop the message — keep the chip
      // alive and tell the user instead of consuming it for nothing.
      if (useWorkbenchStore.getState().agentBusy) {
        toastMsg("生成中 · 请先停止或等待完成再点击");
        return;
      }
      if (messageId) markActionsConsumed(messageId);
      setInput("");
      // Continuations always go to the active session at click time
      void sendWithText(text);
      return;
    }
    if (a.type === "focus") {
      const serial = a.targetSerial;
      if (serial == null) {
        toastMsg("动作未指定窗格");
        return;
      }
      const leaf = st.resolveSerial(serial);
      if (!leaf) {
        toastMsg(`窗格 #${serial} 不存在`);
        return;
      }
      for (const t of st.tabs) {
        if (findLeaf(t.layout, leaf.id)) {
          st.setActiveTab(t.id);
          break;
        }
      }
      st.setActivePane(leaf.id);
      toastMsg(`已聚焦 #${serial}`);
      if (messageId) markActionsConsumed(messageId);
      return;
    }
    if (!a.command?.trim()) {
      toastMsg("动作缺少命令");
      return;
    }
    const run = a.type === "run" || a.type === "insert_and_run";
    if (a.targetSerial != null) {
      const leaf = st.resolveSerial(a.targetSerial);
      if (leaf) {
        for (const t of st.tabs) {
          if (findLeaf(t.layout, leaf.id)) {
            st.setActiveTab(t.id);
            break;
          }
        }
        st.setActivePane(leaf.id);
      }
      insertToPane(a.targetSerial, a.command, run);
    } else {
      insertToPane(undefined, a.command, run);
    }
    if (messageId) markActionsConsumed(messageId);
  };

  const stopGeneration = async () => {
    const streamSid = useWorkbenchStore.getState().agentStreamId;
    const chatSid = streamSessionRef.current;
    if (streamSid && isTauri()) {
      try {
        await agentChatCancel(streamSid);
      } catch {
        /* ignore */
      }
    }
    // Only the first settle writes a message (blocks late done/error)
    if (settleStream()) {
      const partial = streamAccRef.current.trim();
      const th = thinkingAccRef.current.trim();
      if (partial || th) {
        const { thinking, answer } = splitAgentReply(partial, th);
        appendAgentMessage(
          {
            role: "assistant",
            content: (answer || "已停止").slice(0, 200),
            html: markdownToHtml((answer || "已停止") + "\n\n*（已停止）*"),
            thinking: thinking || undefined,
          },
          chatSid,
        );
      } else {
        appendAgentMessage(
          {
            role: "assistant",
            content: "已停止",
            html: markdownToHtml("*已停止生成*"),
          },
          chatSid,
        );
      }
    }
    cleanupStream();
    toastMsg("已停止");
  };

  const sendWithText = async (text: string) => {
    if (!text || agentBusy) return;
    const st0 = useWorkbenchStore.getState();
    const chatSessionId = st0.activeAgentSessionId;
    streamSessionRef.current = chatSessionId;

    // Prior turns only (before this user message) — avoid duplicating current turn
    const history = buildChatHistory(chatSessionId);

    appendAgentMessage({ role: "user", content: text }, chatSessionId);
    setAgentBusy(true);
    if (streamHtmlTimerRef.current != null) {
      window.clearTimeout(streamHtmlTimerRef.current);
      streamHtmlTimerRef.current = null;
    }
    setStreamPreview("");
    setStreamHtml("");
    setThinkingPreview("");
    streamAccRef.current = "";
    thinkingAccRef.current = "";
    streamSettledRef.current = false;

    const st = useWorkbenchStore.getState();
    const bundle = buildContextBundle(st.tabs, st.activeTabId, st.activePaneId, {
      contextScope: settings.contextScope,
      includeDraft: settings.includeDraft,
      contextLines: settings.contextLines,
    });

    const endpoint = settings.aiEndpoint.trim();
    const model = aiModel || settings.aiDefaultModelId;

    // Real endpoint: streaming tool loop (0.7 kernel), fallback to plain stream
    if (endpoint && model && isTauri()) {
      const streamId = nextId("stream");
      setAgentStreamId(streamId);

      // Listener FIRST: tool-loop rounds stream text/thinking under this id.
      // ("done" only arrives from the plain-stream fallback path.)
      try {
        const un = await listen<{
          id: string;
          type: string;
          text?: string;
          error?: string;
        }>("agent://stream", (ev) => {
          if (ev.payload.id !== streamId) return;
          if (streamSettledRef.current) return;
          if (ev.payload.type === "thinking" && ev.payload.text) {
            thinkingAccRef.current += ev.payload.text;
            setThinkingPreview(thinkingAccRef.current);
          }
          if (ev.payload.type === "delta" && ev.payload.text) {
            streamAccRef.current += ev.payload.text;
            setStreamPreview(streamAccRef.current);
          }
          if (ev.payload.type === "error") {
            if (!settleStream()) return;
            const err = ev.payload.error || "请求失败";
            appendAgentMessage(
              { role: "assistant", content: err, html: markdownToHtml(err) },
              chatSessionId,
            );
            cleanupStream();
          }
          if (ev.payload.type === "cancelled") {
            cleanupStream();
          }
          if (ev.payload.type === "done") {
            if (!settleStream()) return;
            finishAssistant(
              streamAccRef.current,
              bundle.focusSerial,
              thinkingAccRef.current,
              chatSessionId,
            );
            cleanupStream();
          }
        });
        unlistenRef.current = un;
      } catch {
        /* listener failure → previews unavailable but loop still works */
      }
      // 1.0 项目级上下文：焦点窗格 cwd 向上找 AETHER.md（git root 截止）
      let projectCtx = "";
      if (settings.projectContext && isTauri()) {
        try {
          const cwd = useWorkbenchStore.getState().activePane()?.cwd || "";
          if (cwd) {
            const { invoke } = await import("@tauri-apps/api/core");
            const hit = await invoke<[string, string] | null>(
              "project_context_read",
              { cwd },
            );
            if (hit) {
              // AETHER.md can contain secrets — redact like all other context.
              projectCtx = `## 项目上下文（${hit[0]}）\n${redactAndTrimContext(hit[1], 4000)}`;
            }
          }
        } catch {
          /* best-effort */
        }
      }

      const system = [
        AGENT_BASE_PROMPT,
        formatAgentSkillsPrompt(),
        formatActiveTaskPrompt(),
        projectCtx,
        "注意：终端上下文可能已截断并脱敏（密钥类字段显示为 ***REDACTED***）。",
        `标签页数: ${bundle.tabCount}`,
        `标签列表: ${bundle.tabsLine}`,
        `当前标签布局: ${bundle.layoutSummary}`,
        `焦点: ${bundle.focusRef} (T${bundle.focusTabIndex}:#${bundle.focusSerial})`,
        `窗格索引(全局): ${bundle.paneIndex.map((p) => `${p.ref} ${p.shellKey} ${p.cwd}`).join(" | ")}`,
        "引用窗格请用 T{标签序号}:#{窗格序号}。",
        "上下文:",
        ...bundle.panes.map(
          (p) =>
            `--- ${p.ref} 标签「${p.tabTitle}」 ${p.shellKey} ${p.cwd}${p.isFocused ? " [焦点]" : ""} ---\n${p.scrollback}\n[draft] ${p.draftInput}\n[hist] ${p.commandHistory.slice(-5).join(" ; ")}`,
        ),
      ]
        .filter(Boolean)
        .join("\n");

      const baseMessages: unknown[] = [
        { role: "system", content: system },
        ...history,
        { role: "user", content: text },
      ];

      // ── Primary path: streaming tool loop (cancellable mid-flight) ──
      let toolFailed = false;
      try {
        setLiveToolTrace([]);
        const loop = await runAgentToolLoop({
          endpoint,
          apiKey: settings.aiApiKey,
          provider: settings.aiProvider,
          model,
          messages: baseMessages,
          // Active task = plan-execute loop; give the model room to advance steps
          maxRounds: formatActiveTaskPrompt() ? 12 : 5,
          streamId,
          effort: aiEffort,
          cb: {
            shouldAbort: () => streamSettledRef.current,
            onStatus: (msg) => {
              if (!streamSettledRef.current && !streamAccRef.current) {
                setStreamPreview(msg);
              }
            },
            onToolEnd: (step) => {
              setLiveToolTrace((prev) => [
                ...prev,
                {
                  name: step.name,
                  argsPreview: step.argsPreview,
                  ok: step.ok,
                  summary: step.summary,
                },
              ]);
            },
          },
        });
        if (loop.cancelled) {
          // Stop button already settled + wrote the partial message; this
          // handles cancellation arriving without user stop (edge case).
          if (settleStream()) {
            finishAssistant(
              loop.text || streamAccRef.current,
              bundle.focusSerial,
              thinkingAccRef.current,
              chatSessionId,
              loop.trace,
            );
          }
          cleanupStream();
          setLiveToolTrace([]);
          return;
        }
        const bad =
          !loop.text ||
          /error decoding response body|TOOLS_UNSUPPORTED|JSON 解析失败|空响应体/i.test(
            loop.text,
          );
        if (!bad && settleStream()) {
          finishAssistant(
            loop.text,
            bundle.focusSerial,
            thinkingAccRef.current,
            chatSessionId,
            loop.trace,
          );
          cleanupStream();
          setLiveToolTrace([]);
          return;
        }
        toolFailed = true;
        setStreamPreview(
          loop.text
            ? `工具结果异常，改用流式… (${loop.text.slice(0, 60)})`
            : "工具无结果，改用流式…",
        );
      } catch (toolErr) {
        toolFailed = true;
        const hint =
          toolErr instanceof Error ? toolErr.message : String(toolErr);
        setStreamPreview(`工具通道不可用，改用流式… (${hint.slice(0, 80)})`);
      }

      // Reset settle so stream fallback can complete (listener stays registered)
      if (toolFailed) {
        streamSettledRef.current = false;
        streamAccRef.current = "";
        thinkingAccRef.current = "";
      }

      // ── Fallback: classic stream (no tools; "done" event finalizes) ──
      try {
        await agentChat({
          endpoint,
          apiKey: settings.aiApiKey,
          provider: settings.aiProvider,
          model,
          streamId,
          messages: [
            { role: "system", content: system },
            ...history,
            { role: "user", content: text },
          ],
        });
      } catch (e) {
        const err = String(e);
        if (settleStream()) {
          appendAgentMessage(
            {
              role: "assistant",
              content: err,
              html: markdownToHtml(err),
            },
            chatSessionId,
          );
          cleanupStream();
        }
      }
      return;
    }

    // Missing config
    if (!endpoint || !model) {
      appendAgentMessage(
        {
          role: "assistant",
          content: "请先在设置中配置 API 端点与模型",
          html: markdownToHtml(
            "请先在 **设置 → Agent** 填写 API 端点与 Key，并选择模型（启动时会自动拉取列表）。\n\n" +
              (!endpoint ? "- 缺少端点\n" : "") +
              (!model ? "- 缺少模型\n" : "") +
              (!isTauri() ? "- 浏览器模式仅支持本地模拟\n" : ""),
          ),
        },
        chatSessionId,
      );
      cleanupStream();
      return;
    }

    // Local mock agent (browser / no tauri)
    mockTimerRef.current = window.setTimeout(() => {
      if (!settleStream()) return;
      const reply = localAgentReply(text, bundle, aiEffort);
      appendAgentMessage(
        {
          role: "assistant",
          content: reply.html.slice(0, 200),
          html: markdownToHtml(reply.html),
          cmd: reply.cmd,
          targetSerial: reply.targetSerial,
        },
        chatSessionId,
      );
      cleanupStream();
    }, effortMeta.delay);
  };

  const createTaskFromSlash = (raw: string) => {
    const body = raw.replace(/^\/task\b\s*/i, "").replace(/^任务[:：]\s*/, "");
    const lines = body.split(/\n/);
    const title = (lines[0] || "未命名任务").slice(0, 48) || "未命名任务";
    const stepSrc = lines.slice(1).join("\n").trim() || body.trim() || title;
    const steps = planFromText(stepSrc);
    const task = createTask(
      title,
      steps.length ? steps : planFromText(title),
      useWorkbenchStore.getState().activeAgentSessionId ?? undefined,
    );
    setActiveTask(task.id);
    setTasksOpen(true);
    setTaskRefresh((n) => n + 1);
    appendAgentMessage({ role: "user", content: raw.trim() || `/task ${title}` });
    appendAgentMessage({
      role: "assistant",
      content: `已创建任务 ${task.id}`,
      html: markdownToHtml(
        `已创建任务 **${task.title}**（${task.steps.length} 步）。\n\n` +
          task.steps
            .map(
              (s, i) =>
                `${i + 1}. ${s.title}${s.command ? ` → \`${s.command}\`` : ""}${
                  s.targetSerial != null ? ` (#${s.targetSerial})` : ""
                }`,
            )
            .join("\n") +
          `\n\n在上方 **任务面板** 中执行 / 跳过。也可继续用自然语言补充步骤。`,
      ),
      cmd: task.steps.find((s) => s.command)?.command,
      targetSerial: task.steps.find((s) => s.command)?.targetSerial,
    });
    toastMsg(`任务已创建 · ${task.steps.length} 步`);
  };

  /** Local slash with typed args only. UI buttons cover new/clear/model/stop. */
  const runSlashLocal = (text: string): boolean => {
    const line = text.trim();
    if (!line.startsWith("/")) return false;

    const focusMatch = line.match(/^\/focus\s+#?(\d+)\s*$/i);
    if (focusMatch) {
      const serial = Number(focusMatch[1]);
      const st = useWorkbenchStore.getState();
      const leaf = st.resolveSerial(serial);
      if (leaf) {
        for (const t of st.tabs) {
          if (findLeaf(t.layout, leaf.id)) {
            st.setActiveTab(t.id);
            break;
          }
        }
        st.setActivePane(leaf.id);
        toastMsg(`已聚焦窗格 #${serial}`);
      } else {
        toastMsg(`未找到窗格 #${serial}`);
      }
      return true;
    }

    if (/^\/task\b/i.test(line) || /^任务[:：]/.test(line)) {
      createTaskFromSlash(line);
      return true;
    }

    return false;
  };

  /** Fill composer with draft slash (always needs args). */
  const applySlash = (item: AgentSlashCommand) => {
    setInput(item.insert);
    setSlashIdx(0);
    requestAnimationFrame(() => {
      const el = document.getElementById("ai-input") as HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        const n = item.insert.length;
        el.setSelectionRange(n, n);
      }
    });
  };

  // 0.8: "AI 诊断" from a failed command block → send block context to agent.
  // Ref keeps the latest sendWithText (its closure holds current settings).
  const sendWithTextRef = useRef<((t: string) => Promise<void>) | null>(null);
  sendWithTextRef.current = sendWithText;
  useEffect(() => {
    const onDiagnose = (ev: Event) => {
      const detail = (ev as CustomEvent<{ paneId: string; blockId: string }>)
        .detail;
      if (!detail) return;
      if (useWorkbenchStore.getState().agentBusy) {
        toastMsg("生成中 · 请先停止或等待完成再诊断");
        return;
      }
      void (async () => {
        const [{ getBlocks, blockHeader, readBlockOutput }, { getLiveTerm }] =
          await Promise.all([
            import("../../lib/commandBlocks"),
            import("../terminal/termRegistry"),
          ]);
        const block = getBlocks(detail.paneId).find(
          (b) => b.id === detail.blockId,
        );
        if (!block) {
          toastMsg("命令块已不存在");
          return;
        }
        const live = getLiveTerm(detail.paneId);
        const out = live ? readBlockOutput(live.term, block, 120) : null;
        const st = useWorkbenchStore.getState();
        let serial = "";
        for (const t of st.tabs) {
          const leaf = findLeaf(t.layout, detail.paneId);
          if (leaf) {
            serial = `#${leaf.serial}`;
            break;
          }
        }
        const prompt = [
          `请诊断窗格 ${serial} 中这条失败的命令，解释原因并给出修复建议：`,
          "",
          "```",
          blockHeader(block),
          ...(out ? [redactAndTrimContext(out, 4000)] : ["（输出已不在缓冲区）"]),
          "```",
        ].join("\n");
        void sendWithTextRef.current?.(prompt);
      })();
    };
    // Generic entry: palette items can send a prepared prompt to the agent
    const onSend = (ev: Event) => {
      const detail = (ev as CustomEvent<{ text: string }>).detail;
      if (!detail?.text) return;
      if (useWorkbenchStore.getState().agentBusy) {
        toastMsg("生成中 · 请先停止或等待完成");
        return;
      }
      void sendWithTextRef.current?.(detail.text);
    };
    window.addEventListener("sw:ai-diagnose", onDiagnose);
    window.addEventListener("sw:ai-send", onSend);
    return () => {
      window.removeEventListener("sw:ai-diagnose", onDiagnose);
      window.removeEventListener("sw:ai-send", onSend);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    // /stop works even while busy — equivalent to the Stop button
    if (/^\/stop\b/i.test(text)) {
      setInput("");
      if (useWorkbenchStore.getState().agentBusy) {
        void stopGeneration();
      } else {
        toastMsg("当前没有正在生成的回复");
      }
      return;
    }
    if (agentBusy) return;

    // 1) Completing slash menu with prefix only → accept selection
    if (
      slashOpen &&
      slashMatches.length &&
      slashEnterShouldAccept(input, slashMatches)
    ) {
      applySlash(slashMatches[slashIdx] ?? slashMatches[0]);
      return;
    }

    // 2) Local slash that need typed args
    if (runSlashLocal(text)) {
      setInput("");
      return;
    }
    if (/^\/focus\s*$/i.test(text)) {
      toastMsg("请输入窗格号，例如 /focus 2");
      setInput("/focus ");
      return;
    }
    if (/^\/task\s*$/i.test(text)) {
      createTaskFromSlash("/task 未命名任务");
      setInput("");
      return;
    }
    // Unknown slash → don't pretend it's a chat message
    if (text.startsWith("/")) {
      toastMsg("可用 /task、/focus · 其它请用上方按钮");
      return;
    }

    setInput("");
    void sendWithText(text);
  };

  return (
    <aside
      className={`ai-panel${aiOpen ? " open" : ""}`}
      id="ai-panel"
      style={{
        ["--ai-width" as string]: `${aiWidth}px`,
        width: aiOpen ? aiWidth : undefined,
      }}
    >
      <div className="ai-resize" id="ai-resize" ref={resizeRef} />
      <div className="ai-header">
        <div className="ai-header-title">
          <svg className="agent-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="7" width="14" height="11" rx="3" />
            <circle cx="9.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="14.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
            <path d="M9 15.2c.8.7 1.6 1 3 1s2.2-.3 3-1" />
            <path d="M12 7V4.5" />
            <circle cx="12" cy="3.5" r="1" fill="currentColor" stroke="none" />
            <path d="M3.5 11.5h1.5M19 11.5h1.5" />
          </svg>
          <span>Agent</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            className={`icon-btn${tasksOpen ? " active" : ""}`}
            title="任务面板"
            aria-label="任务面板"
            style={{ width: 28, height: 28, minWidth: 28, minHeight: 28 }}
            onClick={() => {
              setTasksOpen((v) => !v);
              setHistoryOpen(false);
              setTaskRefresh((n) => n + 1);
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" />
              <path d="M8 9h8M8 12h8M8 15h5" fill="none" stroke="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className={`icon-btn${historyOpen ? " active" : ""}`}
            title="历史会话"
            aria-label="历史会话"
            style={{ width: 28, height: 28, minWidth: 28, minHeight: 28 }}
            onClick={() => {
              setHistoryOpen((v) => !v);
              setTasksOpen(false);
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" />
              <polyline points="12 7 12 12 16 14" fill="none" stroke="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title="清空当前会话"
            aria-label="清空当前会话"
            style={{ width: 28, height: 28, minWidth: 28, minHeight: 28 }}
            onClick={() => {
              void (async () => {
                if (agentBusy) {
                  toastMsg("生成中，请先停止再清空");
                  return;
                }
                const n = session?.messages.length ?? 0;
                if (n === 0) {
                  toastMsg("当前会话已是空的");
                  return;
                }
                const ok = await askConfirm("清空当前会话？", {
                  message: `将删除本会话中的 ${n} 条消息，此操作不可撤销。`,
                  danger: true,
                  okLabel: "清空",
                  cancelLabel: "取消",
                });
                if (ok) clearActiveAgentMessages();
              })();
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title="新会话"
            aria-label="新会话"
            style={{ width: 28, height: 28, minWidth: 28, minHeight: 28 }}
            onClick={() => newAgentSession()}
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" />
              <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" />
            </svg>
          </button>
          <span className="ai-header-focus" id="ai-focus-label">
            焦点 · 窗格 #{paneSerial ?? "—"}
          </span>
        </div>
      </div>

      {/* Task / history: floating cards inside Agent panel only (not layout push-down) */}
      {(tasksOpen || historyOpen) && (
        <div
          className="ai-float-scrim"
          onMouseDown={() => {
            setTasksOpen(false);
            setHistoryOpen(false);
          }}
        />
      )}
      {tasksOpen && (
        <div
          className="ai-float-card ai-float-tasks"
          role="dialog"
          aria-label="任务"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <TaskPanel
            open={tasksOpen}
            onClose={() => setTasksOpen(false)}
            refreshKey={taskRefresh}
          />
        </div>
      )}
      {historyOpen && (
        <div
          className="ai-float-card ai-float-history"
          role="dialog"
          aria-label="历史会话"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="ai-float-head">
            <strong>历史会话</strong>
            <button
              type="button"
              className="pane-close"
              aria-label="关闭"
              onClick={() => setHistoryOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="ai-float-body">
            <input
              type="search"
              className="ai-float-search"
              placeholder="搜索历史会话…"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              autoFocus
            />
            {agentSessions.length === 0 && (
              <div className="ai-float-empty">暂无历史会话</div>
            )}
            <div className="ai-float-list">
              {agentSessions
                .filter((s) => {
                  const q = historyQuery.trim().toLowerCase();
                  if (!q) return true;
                  if (s.title.toLowerCase().includes(q)) return true;
                  return s.messages.some((m) => m.content.toLowerCase().includes(q));
                })
                .map((s) => (
                  <div
                    key={s.id}
                    className={`ai-float-item${s.id === session?.id ? " active" : ""}`}
                    onClick={() => {
                      switchAgentSession(s.id);
                      setHistoryOpen(false);
                    }}
                  >
                    <span className="ai-float-item-title">{s.title}</span>
                    <span className="ai-float-item-meta">
                      {s.messages.length} 条
                    </span>
                    <button
                      type="button"
                      className="pane-close"
                      title="删除会话"
                      onClick={(e) => {
                        e.stopPropagation();
                        void (async () => {
                          const ok = await askConfirm("删除此会话？", {
                            message: `「${s.title}」将被永久删除。`,
                            danger: true,
                            okLabel: "删除",
                          });
                          if (ok) deleteAgentSession(s.id);
                        })();
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {session && session.messages.length > 0 && (
        <div className="ai-session-title" title={session.title}>
          {session.title}
        </div>
      )}
      <div className="ai-messages" id="ai-messages" ref={messagesRef}>
        {session && session.messages.length === 0 && !agentBusy && (
          <div className="ai-empty-hint">
            Agent 是工作台中枢：可分屏、建标签、跑命令、改主题与设置。
            <br />
            <span style={{ color: "var(--muted)" }}>
              试试「左右分屏」「清屏」「切换青色主题」· 窗格用 #N · <code>/</code>task
            </span>
          </div>
        )}
        {session?.messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {showThinking && m.role === "assistant" && m.thinking?.trim() && (
              <div className="msg-thinking">
                <button
                  type="button"
                  className="msg-thinking-toggle"
                  aria-expanded={!!thinkingOpen[m.id]}
                  onClick={() =>
                    setThinkingOpen((prev) => ({
                      ...prev,
                      [m.id]: !prev[m.id],
                    }))
                  }
                >
                  <span className="msg-thinking-chevron" aria-hidden>
                    {thinkingOpen[m.id] ? "▾" : "▸"}
                  </span>
                  思考过程
                  <span className="msg-thinking-hint">
                    {thinkingOpen[m.id] ? "收起" : "展开"}
                  </span>
                </button>
                {thinkingOpen[m.id] && (
                  <div className="msg-thinking-body">{m.thinking}</div>
                )}
              </div>
            )}
            {m.role === "assistant" && m.toolTrace && m.toolTrace.length > 0 && (
              <div className="msg-tool-trace" aria-label="工具调用记录">
                <div className="msg-tool-trace-title">操作轨迹 · {m.toolTrace.length}</div>
                <ul className="msg-tool-trace-list">
                  {m.toolTrace.map((step, i) => (
                    <li
                      key={`${m.id}-tool-${i}`}
                      className={`msg-tool-step${step.ok ? " ok" : " fail"}`}
                    >
                      <span className="msg-tool-name">{step.name}</span>
                      {step.argsPreview ? (
                        <span className="msg-tool-args">{step.argsPreview}</span>
                      ) : null}
                      <span className="msg-tool-sum">{step.summary}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(m.html || m.content) && (
              <div
                className="msg-bubble"
                {...(m.role === "assistant" && m.html
                  ? { dangerouslySetInnerHTML: { __html: m.html } }
                  : m.role === "user"
                    ? { children: m.content }
                    : {
                        dangerouslySetInnerHTML: {
                          __html: markdownToHtml(m.content || ""),
                        },
                      })}
              />
            )}
            {m.role === "assistant" &&
              m.id === lastAssistantId &&
              !m.actionsConsumed &&
              m.actions &&
              m.actions.length > 0 && (
              <div className="msg-actions">
                {m.actions.map((a, i) => (
                  <button
                    key={`${m.id}-act-${i}`}
                    type="button"
                    className="chip-btn"
                    title={a.command || a.text || a.label || a.type}
                    onClick={() =>
                      runAction(
                        {
                          type: a.type,
                          targetSerial: a.targetSerial,
                          command: a.command,
                          text: a.text,
                          label: a.label,
                        },
                        m.id,
                      )
                    }
                  >
                    {a.label || actionChipLabel(a)}
                  </button>
                ))}
              </div>
            )}
            {m.role === "assistant" &&
              m.id === lastAssistantId &&
              !m.actionsConsumed &&
              (!m.actions || m.actions.length === 0) &&
              !!m.cmd?.trim() && (
              <div className="msg-actions">
                <button
                  type="button"
                  className="chip-btn"
                  title={m.cmd}
                  onClick={() =>
                    runAction(
                      { type: "insert", targetSerial: m.targetSerial, command: m.cmd },
                      m.id,
                    )
                  }
                >
                  插入{m.targetSerial != null ? ` #${m.targetSerial}` : ""}
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  title={m.cmd}
                  onClick={() =>
                    runAction(
                      {
                        type: "insert_and_run",
                        targetSerial: m.targetSerial,
                        command: m.cmd,
                      },
                      m.id,
                    )
                  }
                >
                  执行
                </button>
              </div>
            )}
          </div>
        ))}
        {agentBusy && (
          <div className="msg assistant">
            {showThinking && thinkingPreview && (
              <div className="msg-thinking live">
                <div className="msg-thinking-toggle static">
                  <span className="msg-thinking-chevron">·</span>
                  思考中…
                </div>
                <div className="msg-thinking-body compact">{thinkingPreview}</div>
              </div>
            )}
            {liveToolTrace.length > 0 && (
              <div className="msg-tool-trace live" aria-label="正在执行的工具">
                <div className="msg-tool-trace-title">正在操作…</div>
                <ul className="msg-tool-trace-list">
                  {liveToolTrace.map((step, i) => (
                    <li
                      key={`live-tool-${i}`}
                      className={`msg-tool-step${step.ok ? " ok" : " fail"}`}
                    >
                      <span className="msg-tool-name">{step.name}</span>
                      <span className="msg-tool-sum">{step.summary}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div
              className="msg-bubble msg-bubble-stream"
              style={{ color: streamPreview ? "var(--fg)" : "var(--muted)" }}
            >
              {streamPreview ? (
                streamHtml ? (
                  <div
                    className="msg-stream-live md"
                    dangerouslySetInnerHTML={{ __html: streamHtml }}
                  />
                ) : (
                  <span className="msg-stream-live">{streamPreview}</span>
                )
              ) : showThinking && thinkingPreview ? (
                "生成回复…"
              ) : (
                "思考中…"
              )}
            </div>
          </div>
        )}
      </div>

      <div className="ai-composer">
        <div className="ai-input-wrap" style={{ position: "relative" }}>
          {slashOpen && (
            <div className="ai-slash-menu" role="listbox" aria-label="斜杠命令">
              <div className="ai-slash-hint">
                需带参数的命令 · ↑↓ 选择 · Enter 填入 · 清空/新会话/模型请用上方按钮
              </div>
              {slashMatches.map((item, i) => (
                <button
                  key={item.cmd}
                  type="button"
                  className={`ai-slash-item${i === slashIdx ? " active" : ""}`}
                  role="option"
                  aria-selected={i === slashIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySlash(item);
                  }}
                >
                  <span className="ai-slash-cmd">{item.label}</span>
                  <span className="ai-slash-desc">{item.desc}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            className="ai-input"
            id="ai-input"
            rows={2}
            placeholder="描述任务… 多步可用 /task · 聚焦窗格 /focus 2"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (slashOpen && slashMatches.length) {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIdx((i) => Math.max(0, i - 1));
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIdx((i) => Math.min(slashMatches.length - 1, i + 1));
                  return;
                }
                if (e.key === "Tab") {
                  e.preventDefault();
                  applySlash(slashMatches[slashIdx] ?? slashMatches[0]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  const first = input.split("\n")[0] ?? "";
                  if (/^\/\S*$/.test(first.trim())) setInput("");
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                // busy 时放行 /stop（等价停止按钮）；其余输入由 send() 内部拦截
                if (agentBusy && !/^\/stop\b/i.test(input.trim())) return;
                send();
              }
            }}
          />
          <div className="ai-composer-bar">
            <div className="ai-composer-right">
              <button
                type="button"
                className={`ai-think-toggle${showThinking ? " on" : ""}`}
                title={showThinking ? "隐藏思考过程" : "显示思考过程"}
                aria-pressed={showThinking}
                onClick={() => patchSettings({ showThinking: !showThinking })}
              >
                思考
              </button>
              <div className={`ai-model-picker${menuOpen ? " open" : ""}`}>
                <button
                  type="button"
                  className="ai-model-trigger"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="选择模型与回复节奏"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((v) => !v);
                    setMenuPanel("root");
                  }}
                >
                  <span className="ai-model-trigger-label">{triggerLabel}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {menuOpen && (
                  <div
                    className="ai-model-menu"
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {menuPanel === "root" && (
                      <div className="ai-menu-panel active">
                        <button
                          type="button"
                          className="ai-menu-row"
                          role="menuitem"
                          onClick={() => {
                            setMenuPanel("model");
                            void refreshModels();
                          }}
                        >
                          <span className="row-left">模型</span>
                          <span className="row-right">
                            <span>{modelLabel.slice(0, 18)}</span>
                            <svg viewBox="0 0 24 24">
                              <polyline points="9 6 15 12 9 18" />
                            </svg>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="ai-menu-row"
                          role="menuitem"
                          onClick={() => setMenuPanel("effort")}
                        >
                          <span className="row-left">回复节奏</span>
                          <span className="row-right">
                            <span>{effortMeta.short}</span>
                            <svg viewBox="0 0 24 24">
                              <polyline points="9 6 15 12 9 18" />
                            </svg>
                          </span>
                        </button>
                        <div className="ai-menu-sep" />
                        <button
                          type="button"
                          className="ai-menu-row"
                          onClick={() => void refreshModels()}
                        >
                          <span className="row-left">刷新模型列表</span>
                        </button>
                        <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--muted)" }}>
                          {aiModelsStatus}
                        </div>
                        <button
                          type="button"
                          className="ai-menu-row danger-ish"
                          onClick={() => {
                            setAiEffort("medium");
                            if (settings.aiDefaultModelId) setAiModel(settings.aiDefaultModelId);
                            toastMsg("已重置默认模型与回复节奏");
                            setMenuOpen(false);
                          }}
                        >
                          <span className="row-left">重置为默认设置</span>
                        </button>
                      </div>
                    )}
                    {menuPanel === "model" && (
                      <div className="ai-menu-panel active">
                        <button
                          type="button"
                          className="ai-menu-back"
                          onClick={() => setMenuPanel("root")}
                        >
                          <svg viewBox="0 0 24 24">
                            <polyline points="15 6 9 12 15 18" />
                          </svg>
                          模型
                        </button>
                        <div className="ai-menu-title">选择模型（来自 endpoint）</div>
                        {aiModels.length === 0 && (
                          <div style={{ padding: 10, fontSize: 12, color: "var(--muted)" }}>
                            无列表 · 填写设置中的 API 端点后刷新
                          </div>
                        )}
                        {aiModels.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`ai-menu-row${m.id === aiModel ? " selected" : ""}`}
                            onClick={() => {
                              setAiModel(m.id);
                              setMenuPanel("root");
                              toastMsg(`模型 · ${m.label}`);
                            }}
                          >
                            <span className="row-left">{m.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {menuPanel === "effort" && (
                      <div className="ai-menu-panel active">
                        <button
                          type="button"
                          className="ai-menu-back"
                          onClick={() => setMenuPanel("root")}
                        >
                          <svg viewBox="0 0 24 24">
                            <polyline points="15 6 9 12 15 18" />
                          </svg>
                          回复节奏
                        </button>
                        <div className="ai-menu-title">推理力度（OpenAI reasoning_effort / Anthropic thinking）</div>
                        {EFFORTS.map((ef) => (
                          <button
                            key={ef.id}
                            type="button"
                            className={`ai-menu-row${ef.id === aiEffort ? " selected" : ""}`}
                            onClick={() => {
                              setAiEffort(ef.id);
                              setMenuPanel("root");
                              toastMsg(`回复节奏 · ${ef.label}`);
                            }}
                          >
                            <span className="row-left">{ef.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {agentBusy ? (
                <button
                  className="send-btn stop-btn"
                  id="ai-stop"
                  type="button"
                  title="停止生成"
                  onClick={() => void stopGeneration()}
                >
                  停止
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />
                  </svg>
                </button>
              ) : (
                <button
                  className="send-btn"
                  id="ai-send"
                  type="button"
                  onClick={send}
                >
                  发送
                  <svg viewBox="0 0 24 24">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Agent tool approvals stay inside this panel (not full-app overlay) */}
      <AppDialogHost kinds={["approval"]} variant="panel" />
    </aside>
  );
}
