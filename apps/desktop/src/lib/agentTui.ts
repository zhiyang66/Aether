/** Detect full-screen agent CLIs (Codex / Claude Code) and encode Ctrl+Enter. */

export type AgentTuiKind = "codex" | "claude";

const CODEX_MARKERS =
  /\b(?:OpenAI\s+)?Codex\b|\bWorking\s+\(\d+(?:\.\d+)?s\)|\battachments[/\\]paste-/i;
const CLAUDE_MARKERS =
  /\bClaude\s+Code\b|\bclaude\.ai\/code\b|\bAnthropic\s+Claude\b|\b❯\s*Try\s+"|\bctrl\+j\s+to\s+newline\b/i;

/**
 * Shell profiles that launch an agent CLI directly (not a generic shell that
 * later happens to run `codex` / `claude`).
 */
export function agentTuiFromShellKey(shellKey: string): AgentTuiKind | null {
  const key = shellKey.toLowerCase();
  if (key === "codex" || key.startsWith("codex:") || key.includes("codex")) return "codex";
  if (key === "claude" || key.startsWith("claude:") || key.includes("claude")) return "claude";
  return null;
}

/** Heuristic markers from TUI banner / status lines. */
export function detectAgentTuiFromOutput(text: string): AgentTuiKind | null {
  if (CODEX_MARKERS.test(text)) return "codex";
  if (CLAUDE_MARKERS.test(text)) return "claude";
  return null;
}

/**
 * Bytes for the user's Ctrl+Enter chord.
 *
 * Agent TUIs (Codex / Claude Code) treat Alt+Enter as "insert newline".
 * xterm's native Alt+Enter is ESC + CR (`\x1b\r`). ConPTY often drops or
 * mis-translates raw Ctrl+Enter / CSI-u, so when we own the Ctrl+Enter
 * chord we deliberately emit those same Alt+Enter bytes.
 *
 * Detection can lag when the user launches `codex`/`claude` from a normal
 * shell profile, so we also use ESC CR whenever the terminal is already on
 * the alternate screen (where those full-screen composers live).
 *
 * Regular primary-screen shells still use their line-editor encodings via
 * `fallback` (PSReadLine CSI-u, readline quoted Ctrl+J, …).
 */
export function agentTuiCtrlEnterSequence(opts: {
  kind: AgentTuiKind | null;
  /** True when xterm's active buffer is the alternate screen. */
  alternateScreen?: boolean;
  bracketedPasteMode: boolean;
  shellKey: string;
  fallback: (shellKey: string) => string | null;
}): string | null {
  // bracketedPasteMode kept for call-site stability; unused after we switched
  // to the Alt+Enter encoding that agent composers already understand.
  void opts.bracketedPasteMode;
  if (opts.kind || opts.alternateScreen) {
    return "\x1b\r";
  }
  return opts.fallback(opts.shellKey);
}
