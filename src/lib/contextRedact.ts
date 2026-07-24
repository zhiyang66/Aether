/**
 * Redact secrets / credentials from text before sending to Agent API.
 */

const LINE_PATTERNS: RegExp[] = [
  // key: value / key=value (whole secret value)
  /\b(api[_-]?key|access[_-]?token|secret|password|passwd|pwd|private[_-]?key)\b\s*[:=]\s*\S+/gi,
  // Authorization: Bearer xxx  OR  Authorization: xxx
  /\bAuthorization\s*:\s*(?:Bearer\s+)?\S+/gi,
  /\bBearer\s+[a-zA-Z0-9._\-+/=]{8,}/gi,
  /\b(sk-[a-zA-Z0-9_-]{12,})\b/g,
  /\b(ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(xox[baprs]-[0-9a-zA-Z-]{10,})\b/g,
];

/** Cap and redact a scrollback blob for LLM context. */
export function redactAndTrimContext(text: string, maxChars = 6000): string {
  if (!text) return "";
  let t = text.replace(/\r\n/g, "\n");
  for (const re of LINE_PATTERNS) {
    // Reset lastIndex for global regex reuse
    re.lastIndex = 0;
    t = t.replace(re, (m) => {
      const kv = m.match(/^(Authorization)\s*:\s*/i);
      if (kv) return `${kv[1]}: ***REDACTED***`;
      const kv2 = m.match(/^([^:=]+)([:=])\s*/);
      if (kv2 && !/^Bearer\b/i.test(kv2[1])) return `${kv2[1]}${kv2[2]} ***REDACTED***`;
      return "***REDACTED***";
    });
  }
  if (t.length <= maxChars) return t;
  const head = Math.floor(maxChars * 0.25);
  const tail = maxChars - head - 40;
  return `${t.slice(0, head)}\n\n…[截断 ${t.length - maxChars} 字符]…\n\n${t.slice(-tail)}`;
}

export function maxCharsForContextLines(lines: number): number {
  // ~100 chars/line budget, clamp
  return Math.min(12000, Math.max(1500, lines * 100));
}
