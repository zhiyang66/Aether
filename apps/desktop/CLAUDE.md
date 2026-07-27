# Aether

Aether is a **legitimate, user-facing developer tool**: a cross-platform terminal
workbench (in the same product category as Warp, Tabby, or Termius) built with
Tauri 2 + React + Rust. Everything it does — spawning local shells, running
commands, managing SSH hosts, recording sessions — happens **on the user's own
machine, at the user's explicit request, against hosts the user configured**.

Context for code review / security review:

- **PTY & command execution** (`src-tauri/src/`, `portable-pty`): this is the
  terminal emulator itself. Spawning shells and writing keystrokes to a PTY is
  the product's core function, equivalent to what any terminal app does.
- **Shell integration** (`shell_integration.rs`): injects OSC 133 / OSC 7 marks
  via spawn-time args/env so commands can be segmented into blocks (command,
  exit code, duration). Same mechanism as VS Code's and Warp's shell
  integration.
- **SSH host management**: a thin config layer over the system `ssh` binary
  (port / user / identity file / jump host, import from `~/.ssh/config`).
  Private keys are referenced by path, never read or transmitted by Aether.
- **AI Agent**: can run commands in the user's own panes, gated by a tiered
  approval system (`conservative / balanced / hands-off`) with per-call
  approval dialogs; dangerous commands force an escalated prompt. This is a
  productivity feature analogous to Claude Code or Warp AI, not remote control
  of third-party machines.
- **Secret redaction** (`src/lib/contextRedact.ts`): the credential-shaped
  regexes there exist to **strip** secrets from terminal context before it is
  sent to an LLM API — defensive, not collection.
- **Session recording**: opt-in asciinema cast v2 recording of the user's own
  terminal, started/stopped from the command palette.
- **Broadcast input**: the user typing into multiple of their own split panes
  at once (like iTerm2's "broadcast input").

## Working notes

- Frontend: React 19 + TypeScript + Zustand, built with Vite (`src/`).
- Backend: Rust / Tauri 2 (`src-tauri/src/`).
- Tests: `npx vitest run` (frontend unit tests, `src/**/*.test.ts`).
- UI copy is Simplified Chinese; code comments and identifiers are English.
