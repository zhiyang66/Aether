/** Track incomplete command line for PTY input (Enter commits).
 *  Filters terminal auto-replies (CSI CPR, focus-in/out) so history stays clean.
 */

export class CommandLineBuffer {
  private buf = "";
  /** ESC seen, waiting for rest of control sequence across chunks */
  private esc = false;
  /** Inside CSI (ESC [ … final) */
  private csi = false;
  /** Inside OSC (ESC ] … BEL or ST) */
  private osc = false;
  private oscEsc = false;

  push(data: string): string[] {
    const committed: string[] = [];
    for (const ch of data) {
      // OSC: ESC ] … BEL or ESC \
      if (this.osc) {
        if (this.oscEsc) {
          this.oscEsc = false;
          if (ch === "\\") {
            this.osc = false;
            continue;
          }
          // not ST; keep in OSC? rare — drop and end
          this.osc = false;
          continue;
        }
        if (ch === "\x07") {
          this.osc = false;
          continue;
        }
        if (ch === "\x1b") {
          this.oscEsc = true;
          continue;
        }
        continue;
      }

      // CSI: ESC [ intermediate/params final (@–~)
      if (this.csi) {
        // Final byte of CSI
        if (ch >= "@" && ch <= "~") {
          this.csi = false;
          continue;
        }
        // parameter / intermediate bytes — swallow
        continue;
      }

      if (this.esc) {
        this.esc = false;
        if (ch === "[") {
          this.csi = true;
          continue;
        }
        if (ch === "]") {
          this.osc = true;
          continue;
        }
        // SS3 / other single-char after ESC — drop
        if (ch === "O" || ch === "P" || ch === "X" || ch === "^" || ch === "_") {
          // may have more; treat short: drop next until we get something simple
          // SS3 is ESC O P — swallow one more by entering a mini state via csi-like
          this.csi = true; // reuse: final is A–Z typically after O
          continue;
        }
        // lone ESC noise
        continue;
      }

      if (ch === "\x1b") {
        this.esc = true;
        continue;
      }

      // Bare debris if ESC was already lost upstream: [1;1R  [I  [O
      // Only strip when buffer empty or ends with incomplete report noise
      if (this.tryStripBareCsiDebris(ch)) {
        continue;
      }

      if (ch === "\r" || ch === "\n") {
        const line = this.sanitizeLine(this.buf.trim());
        this.buf = "";
        if (line) committed.push(line);
      } else if (ch === "\x7f" || ch === "\b") {
        this.buf = this.buf.slice(0, -1);
      } else if (ch === "\x03") {
        this.buf = "";
      } else if (ch >= " " || ch === "\t") {
        this.buf += ch;
      }
    }
    return committed;
  }

  /**
   * When ESC was dropped (some paths), printable CSI bodies like `1;1R` or `[I`
   * may arrive. Strip common terminal reports only at start of line buffer.
   */
  private tryStripBareCsiDebris(ch: string): boolean {
    // Build a small lookahead in buf for patterns starting at line start
    if (this.buf.length > 24) return false;

    // If we have `[` pending as start of report
    const probe = this.buf + ch;

    // Complete focus-in/out without ESC: [I or [O at start
    if (/^\[I$/.test(probe) || /^\[O$/.test(probe)) {
      this.buf = "";
      return true; // consume ch as part of stripped probe
    }

    // CPR: [digits;digits R  or  digits;digits R
    if (/^\[\d{1,4};\d{1,4}R$/.test(probe) || /^\d{1,4};\d{1,4}R$/.test(probe)) {
      this.buf = "";
      return true;
    }

    // Growing match — hold in buf normally unless clearly starting as report
    // Don't block normal typing of `[` for arrays etc. on mid-line
    return false;
  }

  private sanitizeLine(line: string): string {
    if (!line) return "";
    // Strip leading CSI debris glued before real command
    let s = line
      .replace(/^(?:\x1b\[[\d;?]*[A-Za-z]|\[\d{1,4};\d{1,4}R|\[\d{1,4};\d{1,4}|\[I|\[O)+/g, "")
      .replace(/^(?:\d{1,4};\d{1,4}R)+/g, "")
      .trim();
    // Drop pure report lines
    if (/^\[\d+;\d+R$/.test(s) || /^\[I$/.test(s) || /^\[O$/.test(s)) return "";
    if (/^\d+;\d+R$/.test(s)) return "";
    return s;
  }

  reset() {
    this.buf = "";
    this.esc = false;
    this.csi = false;
    this.osc = false;
    this.oscEsc = false;
  }

  peek() {
    return this.buf;
  }
}
