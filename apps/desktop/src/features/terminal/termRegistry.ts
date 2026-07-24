import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/** Survives React remounts so split layout does not kill existing PTYs. */
export type LiveTerm = {
  term: Terminal;
  fit: FitAddon;
  ptyId: string | null;
  host: HTMLElement | null;
  disposed: boolean;
  /** permanent cleanups (pty listeners) — only run on disposePaneSession */
  sessionCleanups: Array<() => void>;
};

const registry = new Map<string, LiveTerm>();

export function getLiveTerm(paneId: string): LiveTerm | undefined {
  return registry.get(paneId);
}

export function setLiveTerm(paneId: string, live: LiveTerm) {
  registry.set(paneId, live);
}

export function deleteLiveTerm(paneId: string) {
  registry.delete(paneId);
}

/** Move existing xterm DOM into a new host after React remount. */
export function attachHost(paneId: string, host: HTMLElement): LiveTerm | undefined {
  const live = registry.get(paneId);
  if (!live || live.disposed) return undefined;
  const el = live.term.element;
  if (el && el.parentElement !== host) {
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(el);
    live.host = host;
    requestAnimationFrame(() => {
      try {
        live.fit.fit();
        live.term.scrollToBottom();
      } catch {
        /* ignore */
      }
    });
  }
  return live;
}

export function hasLiveTerm(paneId: string): boolean {
  const live = registry.get(paneId);
  return !!live && !live.disposed;
}

/** All non-disposed live sessions (for Agent write fallback). */
export function listLiveTerms(): Array<{ paneId: string; ptyId: string }> {
  const out: Array<{ paneId: string; ptyId: string }> = [];
  for (const [paneId, live] of registry) {
    if (!live.disposed && live.ptyId) {
      out.push({ paneId, ptyId: live.ptyId });
    }
  }
  return out;
}

export function getLivePtyId(paneId: string): string | null {
  const live = registry.get(paneId);
  if (!live || live.disposed) return null;
  return live.ptyId;
}
