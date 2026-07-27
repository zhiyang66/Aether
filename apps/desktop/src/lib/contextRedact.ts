/**
 * Redact secrets / credentials from text before sending to Agent API.
 */

const LINE_PATTERNS: RegExp[] = [
  // key: value / key=value (whole secret value) — broadened key set
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|secret[_-]?access[_-]?key|client[_-]?secret|secret|password|passwd|pwd|token|private[_-]?key|database[_-]?url|conn(?:ection)?[_-]?string)\b\s*[:=]\s*\S+/gi,
  // Authorization: Bearer xxx  OR  Authorization: xxx
  /\bAuthorization\s*:\s*(?:Bearer\s+)?\S+/gi,
  /\bBearer\s+[a-zA-Z0-9._\-+/=]{8,}/gi,
  // PEM private key block (multi-line)
  /-----BEGIN[ A-Z0-9]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9]*PRIVATE KEY-----/g,
  // JWT (header.payload.signature)
  /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}/g,
  // URI with embedded credentials: scheme://user:pass@host → keep scheme, drop userinfo
  /\b[a-z][a-z0-9+.\-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi,
  // Provider tokens / cloud keys
  /\bsk-[a-zA-Z0-9_-]{12,}\b/g,
  /\b[rs]k_(?:live|test)_[a-zA-Z0-9]{10,}\b/g,
  /\b(?:gh[oprsu]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_\-]{35}\b/g,
  /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/g,
];

/** Cap and redact a scrollback blob for LLM context. */
export function redactAndTrimContext(text: string, maxChars = 6000): string {
  if (!text) return "";
  let t = text.replace(/\r\n/g, "\n");
  for (const re of LINE_PATTERNS) {
    // Reset lastIndex for global regex reuse
    re.lastIndex = 0;
    t = t.replace(re, (m) => {
      const auth = m.match(/^(Authorization)\s*:\s*/i);
      if (auth) return `${auth[1]}: ***REDACTED***`;
      // scheme://user:pass@ → keep the scheme, redact the credentials
      const uri = m.match(/^([a-z][a-z0-9+.\-]*:\/\/)/i);
      if (uri) return `${uri[1]}***REDACTED***@`;
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
