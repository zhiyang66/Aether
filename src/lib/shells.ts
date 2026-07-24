export type ShellKey = "ps" | "bash" | "zsh" | "cmd" | "wsl";

export type ShellDef = {
  id: ShellKey;
  name: string;
  short: string;
  desc: string;
  defaultCwd: string;
  banner: string[];
};

export function platformLabel(): "Windows" | "macOS" | "Linux" {
  if (typeof navigator === "undefined") return "Windows";
  if (/Mac/i.test(navigator.userAgent)) return "macOS";
  if (/Linux/i.test(navigator.userAgent) && !/Win/i.test(navigator.userAgent)) return "Linux";
  return "Windows";
}

/** User home for default cwd display (best-effort in browser). */
export function guessHomeDir(): string {
  const p = platformLabel();
  if (p === "Windows") return "C:\\Users\\User";
  if (p === "macOS") return "/Users/user";
  return "/home/user";
}

export function defaultShellForPlatform(): ShellKey {
  const p = platformLabel();
  if (p === "macOS") return "zsh";
  if (p === "Linux") return "bash";
  return "ps";
}

const winHome = () => guessHomeDir();
const nixHome = () => (platformLabel() === "macOS" ? "/Users/user" : "/home/user");

export const SHELLS: Record<ShellKey, ShellDef> = {
  ps: {
    id: "ps",
    name: "PowerShell 7",
    short: "pwsh",
    desc: "Win / macOS / Linux · pwsh",
    defaultCwd: winHome(),
    banner: ["PowerShell 7 · Aether", "输入 help 获取帮助。"],
  },
  bash: {
    id: "bash",
    name: "Bash",
    short: "bash",
    desc: "macOS / Linux · /bin/bash",
    defaultCwd: nixHome(),
    banner: ["GNU bash · Aether", "跨平台终端外壳"],
  },
  zsh: {
    id: "zsh",
    name: "Zsh",
    short: "zsh",
    desc: "macOS 默认 · /bin/zsh",
    defaultCwd: "/Users/user",
    banner: ["zsh · Aether · macOS", "跨平台终端外壳"],
  },
  cmd: {
    id: "cmd",
    name: "命令提示符",
    short: "cmd",
    desc: "Windows · cmd.exe",
    defaultCwd: winHome(),
    banner: ["Microsoft Windows [Version 10.0]", "(c) Microsoft Corporation."],
  },
  wsl: {
    id: "wsl",
    name: "WSL · Ubuntu",
    short: "bash",
    desc: "Windows 子系统",
    defaultCwd: "/home/user",
    banner: ["Welcome to Ubuntu (WSL2)", "Windows 子系统"],
  },
};

export const SHELL_MENU_KEYS: ShellKey[] = ["ps", "bash", "zsh", "cmd"];

export function promptText(shellKey: string, cwd: string): string {
  if (shellKey.startsWith("wsl")) return `user@wsl:~$ `;
  switch (shellKey) {
    case "ps":
      return `PS ${cwd}> `;
    case "bash":
      return `dev@host:~$ `;
    case "zsh":
      return `dev@mac ~ % `;
    case "cmd":
      return `${cwd}>`;
    default:
      return `${cwd}> `;
  }
}
