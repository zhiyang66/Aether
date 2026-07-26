/** Heuristic: commands that should require confirmation before Agent auto-run. */

const PATTERNS: RegExp[] = [
  // Recursive PowerShell delete (flag order independent)
  /\bRemove-Item\b(?=[\s\S]*(?:-Recurse\b))/i,
  /\b(format|mkfs|diskpart)\b/i,
  // dd writing to a raw device (either direction)
  /\bdd\b[^|;&\n]*\b(?:if=\/dev\/|of=\/dev\/)/i,
  /\bshutdown\b/i,
  /\bStop-Computer\b/i,
  /\bClear-Disk\b/i,
  /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE)\b/i,
  // git force push (short or long flag), excluding the safer --force-with-lease
  /\bgit\s+push\b[\s\S]*(?:--force(?!-with-lease)\b|(?:^|\s)-[a-zA-Z]*f\b)/i,
  // recursive chmod to world-writable / all-permissions (flag order independent)
  /\bchmod\b(?=[\s\S]*(?:-R\b|--recursive\b))(?=[\s\S]*(?:0?777\b|a\+rwx\b))/i,
  // eval / expression evaluation of arbitrary input
  /\beval\b/i,
  /\bInvoke-Expression\b/i,
  /\biex\b/i,
  // privileged interactive/shell escalation
  /\bsudo\s+(?:-i\b|-s\b|su\b|bash\b|sh\b|zsh\b|-\s|$)/i,
  // Destructive wipe / disk
  /\bFormat-Volume\b/i,
  /\bClear-Content\b.*\$PROFILE/i,
  /\bdel\s+\/[sq]\b/i,
  /\brd\s+\/s\b/i,
];

/** Split a command line into segments on shell separators. */
function splitSegments(cmd: string): string[] {
  return cmd.split(/\|\||&&|;|\n|\||&/);
}

/** `rm` invoked with a recursive flag (any spelling / position). */
function hasRecursiveRm(cmd: string): boolean {
  for (const seg of splitSegments(cmd)) {
    const tokens = seg.trim().split(/\s+/);
    const idx = tokens.findIndex((t) => t === "rm" || /(?:^|\/)rm$/.test(t));
    if (idx < 0) continue;
    const flags = tokens.slice(idx + 1);
    if (
      flags.some(
        (t) => t === "--recursive" || (/^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(t) && t !== "-"),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Anything piped into a shell interpreter (curl … | sudo bash, base64 -d | sh, …). */
function pipesToShell(cmd: string): boolean {
  return (
    /\|\s*(?:sudo\s+|command\s+|env\s+[^|]*\s+)?(?:\/\S+\/)?(?:ba|z|da|k|c)?sh\b/i.test(cmd) ||
    /\|\s*(?:sudo\s+)?(?:pwsh|powershell)\b/i.test(cmd)
  );
}

export function isDangerousCommand(cmd: string): boolean {
  const c = cmd.trim();
  if (!c) return false;
  if (hasRecursiveRm(c)) return true;
  if (pipesToShell(c)) return true;
  return PATTERNS.some((re) => re.test(c));
}

export type DangerNote = "" | "insert-only" | "danger-insert" | "danger-auto-run";

export type DangerDecision = {
  /** Actually press Enter? */
  run: boolean;
  dangerous: boolean;
  /** Which user-visible warning applies ("" = silent). */
  note: DangerNote;
};

/**
 * Single policy for Agent-initiated command execution — the store path
 * (insertToPane) and the tool loop (run_command) MUST both go through this
 * so the two channels never disagree.
 *
 * - execMode=insert: never run
 * - execMode=confirm + confirmDanger + dangerous: downgrade to insert-only
 * - execMode=auto + confirmDanger + dangerous: run, but warn
 */
export function resolveDangerAction(
  cmd: string,
  settings: { execMode: "insert" | "confirm" | "auto"; confirmDanger: boolean },
  wantRun: boolean,
): DangerDecision {
  const dangerous = isDangerousCommand(cmd);
  if (!wantRun) return { run: false, dangerous, note: "" };
  if (settings.execMode === "insert") {
    return { run: false, dangerous, note: "insert-only" };
  }
  if (dangerous && settings.confirmDanger) {
    if (settings.execMode === "confirm") {
      return { run: false, dangerous, note: "danger-insert" };
    }
    return { run: true, dangerous, note: "danger-auto-run" };
  }
  return { run: true, dangerous, note: "" };
}
