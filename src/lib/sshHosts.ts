/**
 * SSH host management (1.0). No SSH protocol implementation — the system
 * `ssh` executable is the kernel; we only assemble arguments and expose
 * hosts as shell profiles (shellKey `ssh:<name>`).
 *
 * identityFile paths are local-only; hosts are NOT part of workbench export.
 */

import type { ScannedShellProfile } from "./shellProfile";

export type SshHost = {
  id: string;
  name: string;
  host: string;
  port?: number;
  user?: string;
  identityFile?: string;
  jumpHost?: string;
  extraArgs?: string[];
};

export const SSH_HOSTS_KEY = "sw-ssh-hosts-v1";

/**
 * A value that becomes an ssh argv token must not be parsed as an option.
 * `ssh` treats any token starting with `-` as a flag (e.g. `-oProxyCommand=…`
 * → arbitrary local command execution), so reject leading-dash values.
 */
export function isSafeSshValue(v: string | undefined | null): boolean {
  if (v == null || v === "") return true;
  return !v.trim().startsWith("-");
}

const listeners = new Set<() => void>();

export function onSshHostsChanged(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function loadSshHosts(): SshHost[] {
  try {
    const raw = localStorage.getItem(SSH_HOSTS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data)
      ? data.filter(
          (h) =>
            h &&
            typeof h.id === "string" &&
            typeof h.name === "string" &&
            typeof h.host === "string" &&
            h.host.trim() &&
            isSafeSshValue(h.host) &&
            isSafeSshValue(h.user) &&
            isSafeSshValue(h.identityFile) &&
            isSafeSshValue(h.jumpHost),
        )
      : [];
  } catch {
    return [];
  }
}

export function saveSshHosts(list: SshHost[]) {
  localStorage.setItem(SSH_HOSTS_KEY, JSON.stringify(list.slice(0, 50)));
  emit();
}

export function upsertSshHost(host: SshHost) {
  const list = loadSshHosts();
  const idx = list.findIndex((h) => h.id === host.id);
  if (idx >= 0) list[idx] = host;
  else list.push(host);
  saveSshHosts(list);
}

export function deleteSshHost(id: string) {
  saveSshHosts(loadSshHosts().filter((h) => h.id !== id));
}

export function newSshHostId(): string {
  return `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Assemble ssh CLI args for a host (target last). */
export function buildSshArgs(h: SshHost): string[] {
  const args: string[] = [];
  if (h.port && h.port > 0 && h.port < 65536 && h.port !== 22) args.push("-p", String(h.port));
  if (h.identityFile?.trim() && isSafeSshValue(h.identityFile)) {
    args.push("-i", h.identityFile.trim());
  }
  if (h.jumpHost?.trim() && isSafeSshValue(h.jumpHost)) args.push("-J", h.jumpHost.trim());
  for (const a of h.extraArgs ?? []) {
    if (a.trim()) args.push(a.trim());
  }
  const user = h.user?.trim();
  const host = h.host.trim();
  const target = user && isSafeSshValue(user) ? `${user}@${host}` : host;
  // `--` terminates option parsing so a host/user can never be read as a flag.
  args.push("--", target);
  return args;
}

/** Hosts as shell profiles for the new-tab/split menus. */
export function sshProfiles(): ScannedShellProfile[] {
  return loadSshHosts().map((h) => ({
    id: `ssh:${h.id}`,
    name: `SSH · ${h.name}`,
    shellKey: `ssh:${h.name}`,
    path: "ssh",
    args: buildSshArgs(h),
    available: true,
    short: "SSH",
    desc: `${h.user ? `${h.user}@` : ""}${h.host}${h.port && h.port !== 22 ? `:${h.port}` : ""}`,
  }));
}

/**
 * Parse a subset of ~/.ssh/config: Host blocks with HostName / User / Port /
 * IdentityFile / ProxyJump. Wildcard Host patterns (* ?) are skipped.
 */
export function parseSshConfig(text: string): Omit<SshHost, "id">[] {
  const out: Omit<SshHost, "id">[] = [];
  let cur: Omit<SshHost, "id"> | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "host") {
      if (cur && cur.host) out.push(cur);
      cur = null;
      const first = val.split(/\s+/)[0];
      if (!first || /[*?]/.test(first)) continue; // skip wildcard blocks
      cur = { name: first, host: first };
      continue;
    }
    if (!cur) continue;
    if (key === "hostname") cur.host = val;
    else if (key === "user") cur.user = val;
    else if (key === "port") {
      const p = Number(val);
      if (Number.isFinite(p) && p > 0 && p < 65536) cur.port = p;
    } else if (key === "identityfile") cur.identityFile = val.replace(/^"|"$/g, "");
    else if (key === "proxyjump") cur.jumpHost = val;
  }
  if (cur && cur.host) out.push(cur);
  // Never import entries whose fields would be parsed as ssh options.
  return out.filter(
    (h) =>
      isSafeSshValue(h.host) &&
      isSafeSshValue(h.user) &&
      isSafeSshValue(h.identityFile) &&
      isSafeSshValue(h.jumpHost),
  );
}
