/** Safe transport helpers for text sent directly to an interactive PTY. */

export type TerminalPasteResult =
  | { ok: true; payload: string }
  | { ok: false; reason: string };

/** Shells that understand the terminal's bracketed-paste protocol. */
export function supportsBracketedPaste(shellKey: string): boolean {
  return shellKey.toLowerCase() !== "cmd";
}

/**
 * Keep a multiline paste as one atomic editing operation. Readline/PSReadLine
 * then keeps line breaks literal instead of submitting or merging commands.
 */
export function prepareTerminalPaste(text: string, shellKey: string): TerminalPasteResult {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized) return { ok: false, reason: "剪贴板为空" };
  if (!normalized.includes("\n")) return { ok: true, payload: normalized };
  if (!supportsBracketedPaste(shellKey)) {
    return {
      ok: false,
      reason: "cmd 不支持安全的多行粘贴，请拆成单行后再执行",
    };
  }
  return { ok: true, payload: `\x1b[200~${normalized}\x1b[201~` };
}

/** Agent execution is intentionally limited to one complete interactive command. */
export function validateAgentShellCommand(command: string): TerminalPasteResult {
  if (command.length > 240) {
    return {
      ok: false,
      reason: "run_command 自动执行只支持不超过 240 字符的短命令。请拆成小步骤，每步读取结果后再继续。",
    };
  }
  if (/\r|\n/.test(command)) {
    return {
      ok: false,
      reason: "run_command 不支持多行命令。请拆成小的单行命令，每步读取结果后再继续。",
    };
  }
  if (/<<-?\s*['\"]?[A-Za-z_][A-Za-z0-9_]*['\"]?/.test(command)) {
    return {
      ok: false,
      reason: "run_command 不支持 heredoc。请改用单行命令，并在每步后确认终端结果。",
    };
  }
  if (/[;|&?]/.test(command)) {
    return {
      ok: false,
      reason: "run_command 不支持 ;、|、&、? 等复合 Shell 语法。请每次只执行一条短命令，并读取结果后再继续。",
    };
  }
  return { ok: true, payload: command };
}
