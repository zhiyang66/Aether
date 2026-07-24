/** Resolve terminal key chords used inside a focused xterm/PTY pane. */

export type TermShortcut =
  | { action: "sigint" }
  | { action: "copy"; text: string }
  | { action: "paste" }
  | { action: "clear" }
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
export function resolveTerminalShortcut(
  e: TermShortcutEvent,
  opts: { hasSelection: boolean; selection: string },
): TermShortcut {
  if (e.type && e.type !== "keydown") return { action: "pass" };

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
