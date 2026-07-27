import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { agentChatStreamToolsRound } from "../../lib/agentToolLoop";
import { agentChatCancel } from "../../ipc/pty";
import { isDangerousCommand } from "../../lib/danger";
import { isTauri } from "../../lib/window";
import { getBlocks, blockHeader } from "../../lib/commandBlocks";
import { nextId } from "../../lib/ids";

/**
 * 1.0 行内 Ctrl+K：自然语言 → 单条命令（单轮轻量请求，走 0.7 内核）。
 * Enter 生成/插入，Ctrl+Enter 直接执行（走 insertToPane 危险策略），
 * Alt+Enter 回到描述改写，Esc 关闭。
 */
export function InlineK({
  paneId,
  shellKey,
  cwd,
  open,
  onClose,
  onInsert,
}: {
  paneId: string;
  shellKey: string;
  cwd: string;
  open: boolean;
  onClose: () => void;
  /** write text into this pane's PTY; run=true appends Enter */
  onInsert: (text: string, run: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"query" | "command">("query");
  const [busy, setBusy] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [lastCmd, setLastCmd] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const streamIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setMode("query");
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    } else if (streamIdRef.current) {
      void agentChatCancel(streamIdRef.current);
      streamIdRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  const dangerous = mode === "command" && isDangerousCommand(value);

  const generate = async () => {
    const query = value.trim();
    if (!query || busy) return;
    const settings = useSettingsStore.getState();
    const st = useWorkbenchStore.getState();
    const model = st.aiModel || settings.aiDefaultModelId;
    const endpoint = settings.aiEndpoint.trim().replace(/\/$/, "");
    if (!isTauri() || !settings.aiEnabled || !endpoint || !model) {
      st.toastMsg("Ctrl+K 需要已配置的 Agent（设置 → Agent）");
      return;
    }
    setBusy(true);
    const recentBlocks = getBlocks(paneId)
      .slice(-2)
      .map((b) => blockHeader(b))
      .join("\n");
    const system = [
      `你是命令行生成器。根据用户描述生成一条可直接执行的 ${shellKey} 命令。`,
      "只输出命令本身：不要解释、不要 markdown 代码块、不要引号包裹、单行。",
      `cwd: ${cwd || "（未知）"}`,
      recentBlocks ? `最近命令块:\n${recentBlocks}` : "",
      lastCmd ? `上一条生成的命令: ${lastCmd}（用户可能在其基础上追加要求）` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const streamId = nextId("kbar");
    streamIdRef.current = streamId;
    try {
      const res = await agentChatStreamToolsRound({
        endpoint,
        apiKey: settings.aiApiKey,
        provider: settings.aiProvider,
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: query },
        ],
        tools: [],
        streamId,
        effort: "low",
      });
      const cmd = (res.content || "")
        .replace(/^```[a-z]*\n?/i, "")
        .replace(/\n?```$/, "")
        .trim()
        .split("\n")[0]
        .trim();
      if (!cmd) {
        useWorkbenchStore.getState().toastMsg("未生成命令，请换个说法");
      } else {
        setLastQuery(query);
        setLastCmd(cmd);
        setValue(cmd);
        setMode("command");
      }
    } catch (e) {
      useWorkbenchStore
        .getState()
        .toastMsg(`生成失败: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    } finally {
      streamIdRef.current = null;
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  return (
    <div className="inline-k">
      <span className="inline-k-icon">{mode === "query" ? "✨" : dangerous ? "⚠" : "❯"}</span>
      <input
        ref={inputRef}
        className={`inline-k-input${dangerous ? " danger" : ""}`}
        value={value}
        placeholder={
          mode === "query"
            ? "描述你想做的事…（Enter 生成命令 · Esc 关闭）"
            : "Enter 插入 · Ctrl+Enter 执行 · Alt+Enter 重新描述"
        }
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === "Enter" && e.altKey) {
            e.preventDefault();
            setMode("query");
            setValue(lastQuery);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (mode === "query") {
              void generate();
            } else if (value.trim()) {
              // Ctrl+Enter runs (user-initiated → store danger policy applies)
              onInsert(value.trim(), e.ctrlKey);
              onClose();
            }
          }
        }}
      />
      {busy && <span className="inline-k-busy">生成中…</span>}
      {dangerous && <span className="inline-k-danger-note">危险命令 · 请确认</span>}
    </div>
  );
}
