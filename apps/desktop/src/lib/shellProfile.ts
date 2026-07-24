/** Scanned shell profiles (from Rust shell_scan or browser fallback). */

export type ScannedShellProfile = {
  id: string;
  name: string;
  shellKey: string;
  path: string;
  args: string[];
  available: boolean;
  short: string;
  desc: string;
};

/** Map backend snake_case to frontend. */
export function mapScanRow(row: {
  id: string;
  name: string;
  shell_key: string;
  path: string;
  args: string[];
  available: boolean;
  short?: string;
  desc?: string;
}): ScannedShellProfile {
  return {
    id: row.id,
    name: row.name,
    shellKey: row.shell_key,
    path: row.path,
    args: row.args || [],
    available: row.available,
    short: row.short || row.name.slice(0, 3),
    desc: row.desc || row.path,
  };
}

/** Icon class for tab dots / menu. */
export function shellIconClass(shellKey: string): string {
  if (shellKey.startsWith("wsl")) return "bash";
  if (shellKey === "ps" || shellKey.startsWith("ps")) return "ps";
  if (shellKey === "cmd") return "cmd";
  if (shellKey === "zsh") return "zsh";
  if (shellKey === "bash") return "bash";
  return "bash";
}

/** Browser / non-tauri minimal fallback (dev only). */
export function browserFallbackProfiles(): ScannedShellProfile[] {
  const win = typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent);
  if (win) {
    return [
      {
        id: "ps-pwsh",
        name: "PowerShell 7",
        shellKey: "ps",
        path: "pwsh",
        args: [],
        available: true,
        short: "PS",
        desc: "浏览器开发回退 · 请用桌面端扫描",
      },
      {
        id: "cmd",
        name: "命令提示符",
        shellKey: "cmd",
        path: "cmd.exe",
        args: [],
        available: true,
        short: "C\\",
        desc: "浏览器开发回退",
      },
    ];
  }
  return [
    {
      id: "bash",
      name: "Bash",
      shellKey: "bash",
      path: "/bin/bash",
      args: [],
      available: true,
      short: "sh",
      desc: "浏览器开发回退",
    },
    {
      id: "zsh",
      name: "Zsh",
      shellKey: "zsh",
      path: "/bin/zsh",
      args: [],
      available: true,
      short: "Z",
      desc: "浏览器开发回退",
    },
  ];
}
