/**
 * Parse cwd hints from PTY output.
 * - OSC 7: ESC ] 7 ; file://… ST
 * - OSC 9;9 (ConEmu/Windows Terminal): ESC ] 9 ; 9 ; path ST
 * - OSC 51 (VS Code): sometimes used for cwd
 */

const ST = "(?:\\x07|\\x1b\\\\)";

/** OSC 7 file URL */
const OSC7_FULL = new RegExp(`\\x1b\\]7;(file://[^\\x07\\x1b]+)${ST}`, "g");

/** OSC 9;9;C:\\path  (Windows Terminal / ConEmu) */
const OSC99 = new RegExp(`\\x1b\\]9;9;([^\\x07\\x1b]+)${ST}`, "g");

export function parseOsc7Cwd(chunk: string): string | null {
  let last: string | null = null;
  let m: RegExpExecArray | null;

  const re7 = new RegExp(OSC7_FULL.source, "g");
  while ((m = re7.exec(chunk)) !== null) {
    const cwd = fileUrlToPath(m[1]);
    if (cwd) last = cwd;
  }

  const re99 = new RegExp(OSC99.source, "g");
  while ((m = re99.exec(chunk)) !== null) {
    try {
      last = decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
    } catch {
      last = m[1].trim();
    }
  }

  return last;
}

/**
 * Best-effort: parse PowerShell prompt line `PS C:\path>` from plain output.
 * Used as fallback when shell does not emit OSC 7.
 */
export function parsePsPromptCwd(plain: string): string | null {
  // Match last PS path in chunk
  const re = /PS\s+([A-Za-z]:[^>\r\n]*?)\s*>/g;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(plain)) !== null) {
    last = m[1].trim();
  }
  return last;
}

/** bash/zsh style: user@host:~/path$ or user@host:/abs$ */
export function parseUnixPromptCwd(plain: string): string | null {
  const re = /(?:^|[\r\n])[^\r\n]*?@[^:\r\n]+:([~/][^\s$#\r\n]*?)\s*[#$]/gm;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(plain)) !== null) {
    last = m[1].trim();
  }
  return last;
}

export function fileUrlToPath(uri: string): string | null {
  try {
    if (!uri.startsWith("file:")) return null;
    let rest = uri.slice("file:".length);
    if (rest.startsWith("//")) {
      rest = rest.slice(2);
      const slash = rest.indexOf("/");
      if (slash < 0) return null;
      const host = rest.slice(0, slash);
      let path = rest.slice(slash);
      path = decodeURIComponent(path);
      if (/^\/[A-Za-z]:\//.test(path) || /^\/[A-Za-z]:\\/.test(path)) {
        path = path.slice(1).replace(/\//g, "\\");
      } else if (host && host !== "localhost" && host !== "" && /^[A-Za-z]$/.test(host)) {
        path = host + ":" + path.replace(/\//g, "\\");
      }
      // file:///C:/Users → already handled; file://localhost/C:/Users
      if (/^\/[A-Za-z]:/.test(path)) {
        path = path.slice(1).replace(/\//g, "\\");
      }
      return path || null;
    }
    return decodeURIComponent(rest) || null;
  } catch {
    return null;
  }
}

export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[PX^_].*?\x1b\\/g, "")
    .replace(/\x1b./g, "");
}

/** Combine OSC + prompt heuristics. */
export function detectCwdFromOutput(chunk: string): string | null {
  const fromOsc = parseOsc7Cwd(chunk);
  if (fromOsc) return fromOsc;
  const plain = stripAnsi(chunk);
  return parsePsPromptCwd(plain) || parseUnixPromptCwd(plain);
}
