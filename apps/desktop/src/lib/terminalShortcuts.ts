/** Resolve terminal key chords used inside a focused xterm/PTY pane. */

export type TermShortcut =
  | { action: "sigint" }
  | { action: "copy"; text: string }
  | { action: "paste" }
  | { action: "clear" }
  /** Workbench-level chord: xterm must NOT process it (would leak control
   *  bytes to the shell); the event bubbles to the window handler instead. */
  | { action: "workbench" }
  | { action: "pass" };

export type TermShortcutEvent = {
  type?: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/**
 * Terminal chords (Windows/Linux Ctrl, macOS ⌘ via metaKey):
 * - Ctrl+C: copy if selection, else SIGINT (\x03)
 * - Ctrl+Shift+C: always copy (selection)
 * - Ctrl+V / Ctrl+Shift+V: paste
 * - Ctrl+L: clear screen
 * - Ctrl+Insert: copy · Shift+Insert: paste
 */
/** Chords owned by the workbench window handler (tabs, panes, palette, AI…). */
export function isWorkbenchChord(e: TermShortcutEvent): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = e.ctrlKey || e.metaKey;
  // Alt+Shift+D / Alt+Shift+E — split panes (alt chords also leak ESC-prefixed bytes)
  if (!mod && e.altKey && e.shiftKey && (key === "d" || key === "e")) return true;
  if (!mod) return false;
  // Ctrl+Alt+←/→ — pane focus switch
  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return true;
  if (e.altKey) return false;
  // Ctrl+Shift+P/A/W/M — palette, AI panel, close pane, focus maximize
  if (e.shiftKey && (key === "p" || key === "a" || key === "w" || key === "m")) return true;
  // Ctrl+T / Ctrl+W / Ctrl+, — new tab, close tab, settings
  if (!e.shiftKey && (key === "t" || key === "w" || key === ",")) return true;
  return false;
}

export function resolveTerminalShortcut(
  e: TermShortcutEvent,
  opts: { hasSelection: boolean; selection: string },
): TermShortcut {
  if (e.type && e.type !== "keydown") return { action: "pass" };

  if (isWorkbenchChord(e)) return { action: "workbench" };

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = e.ctrlKey || e.metaKey;

  // Shift+Insert paste (no Ctrl)
  if (!mod && e.shiftKey && !e.altKey && key === "Insert") {
    return { action: "paste" };
  }

  if (!mod || e.altKey) return { action: "pass" };

  // Ctrl+Insert copy
  if (key === "Insert" && !e.shiftKey) {
    return opts.hasSelection
      ? { action: "copy", text: opts.selection }
      : { action: "pass" };
  }

  if (key === "c") {
    // Ctrl+Shift+C always tries copy; Ctrl+C copies only with selection
    if (e.shiftKey || opts.hasSelection) {
      return { action: "copy", text: opts.selection };
    }
    return { action: "sigint" };
  }

  if (key === "v") {
    return { action: "paste" };
  }

  if (key === "l" && !e.shiftKey) {
    return { action: "clear" };
  }

  return { action: "pass" };
}
