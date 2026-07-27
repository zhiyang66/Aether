import type { ShellKey } from "./shells";
import type { TermLine } from "./layout";

/** Temporary in-process shell for UI parity before PTY lands. */
/**
 * Naive path resolution for the mock shell's `cd` — keeps pane.cwd honest
 * in browser mode (OSC 7 only exists on the real PTY path).
 */
export function resolveMockCwd(cur: string, target: string, shellKey: string): string {
  const isWin = shellKey === "ps" || shellKey === "cmd" || shellKey.startsWith("ps");
  const sep = isWin ? "\\" : "/";
  const home = isWin ? "C:\\Users\\user" : "~";
  const t = target.replace(/^["']|["']$/g, "").trim();
  if (!t || t === "~") return home;
  const normalized = t.replace(/[\\/]+/g, sep);
  const isAbs = isWin
    ? /^[a-zA-Z]:/.test(normalized)
    : normalized.startsWith("/") || normalized.startsWith("~");
  const full = isAbs ? normalized : `${cur.replace(/[\\/]+$/, "")}${sep}${normalized}`;
  const segs: string[] = [];
  for (const seg of full.split(/[\\/]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      // keep drive/root segment ("C:" or "~" or first "/" part)
      if (segs.length > 1 || (segs.length === 1 && !/^([a-zA-Z]:|~)$/.test(segs[0]))) {
        segs.pop();
      }
      continue;
    }
    segs.push(seg);
  }
  if (!segs.length) return isWin ? cur : "/";
  const joined = segs.join(sep);
  if (!isWin && !joined.startsWith("~")) return `/${joined}`.replace(/^\/\//, "/");
  return joined;
}

export function mockRunCommand(shellKey: ShellKey, cmd: string): TermLine[] {
  const c = cmd.trim();
  if (!c) return [];

  if (shellKey === "ps" || shellKey === "cmd") {
    if (c === "help" || /^Get-Help\b/i.test(c)) {
      return [
        {
          cls: "out",
          text: "常用命令: Get-ChildItem (ls), Get-Location (pwd), clear, exit",
        },
      ];
    }
    if (/^(ls|dir|gci|Get-ChildItem)\b/i.test(c)) {
      return [
        { cls: "out", text: "    Directory: workspace\n" },
        { cls: "out", text: "Mode  LastWriteTime  Length Name" },
        { cls: "out", text: "d----  Projects" },
        { cls: "out", text: "-a---  notes.md" },
      ];
    }
    if (/^(pwd|Get-Location)\b/i.test(c)) {
      return [{ cls: "out", text: "C:\\Users\\dev" }];
    }
    if (/^(cls|clear|Clear-Host)\b/i.test(c)) return [{ clear: true, text: "" }];
    if (/^echo\s+/i.test(c) || /^Write-Output\s+/i.test(c)) {
      return [
        {
          cls: "out",
          text: c.replace(/^(echo|Write-Output)\s+/i, "").replace(/^["']|["']$/g, ""),
        },
      ];
    }
    if (/^whoami\b/i.test(c)) return [{ cls: "out", text: "dev-machine\\dev" }];
    if (shellKey === "cmd") {
      return [
        {
          cls: "err",
          text: `'${c.split(/\s+/)[0]}' 不是内部或外部命令，也不是可运行的程序或批处理文件。`,
        },
      ];
    }
    return [
      {
        cls: "err",
        text: `${c} : 无法将“${c.split(/\s+/)[0]}”项识别为 cmdlet、函数、脚本文件或可运行程序的名称。`,
      },
    ];
  }

  // bash / zsh / wsl
  if (c === "help") return [{ cls: "out", text: "try: ls, pwd, uname -a, clear" }];
  if (/^ls\b/.test(c)) {
    return [{ cls: "out", text: "Desktop  Documents  Downloads  projects" }];
  }
  if (/^pwd\b/.test(c)) {
    return [
      {
        cls: "out",
        text: shellKey === "zsh" ? "/Users/dev" : shellKey === "wsl" ? "/home/user" : "/home/dev",
      },
    ];
  }
  if (/^uname\b/.test(c)) {
    return [
      {
        cls: "out",
        text:
          shellKey === "zsh"
            ? "Darwin mac arm64"
            : "Linux host x86_64 GNU/Linux",
      },
    ];
  }
  if (/^(clear|cls)\b/.test(c)) return [{ clear: true, text: "" }];
  if (/^echo\s+/.test(c)) {
    return [{ cls: "out", text: c.replace(/^echo\s+/, "").replace(/^["']|["']$/g, "") }];
  }
  if (/^whoami\b/.test(c)) return [{ cls: "out", text: "dev" }];
  return [
    {
      cls: "err",
      text: `${shellKey === "zsh" ? "zsh" : "bash"}: command not found: ${c.split(/\s+/)[0]}`,
    },
  ];
}
