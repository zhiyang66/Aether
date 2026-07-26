/** Heuristic: commands that should require confirmation before Agent auto-run. */

const PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)/i,
  /\bRemove-Item\b.*(-Recurse|-r).*-Force/i,
  /\b(format|mkfs|diskpart)\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\bStop-Computer\b/i,
  /\bClear-Disk\b/i,
  /\b(DROP|TRUNCATE)\s+TABLE\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bwget\b.*\|\s*(ba)?sh\b/i,
  /\bInvoke-Expression\b/i,
  /\biex\b/i,
  // Destructive wipe / disk
  /\bFormat-Volume\b/i,
  /\bClear-Content\b.*\$PROFILE/i,
  /\bdel\s+\/[sq]\b/i,
  /\brd\s+\/s\b/i,
];

export function isDangerousCommand(cmd: string): boolean {
  const c = cmd.trim();
  if (!c) return false;
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
