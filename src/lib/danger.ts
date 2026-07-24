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
