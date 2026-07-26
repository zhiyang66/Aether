//! Shell integration (OSC 133 command marks + OSC 7 cwd).
//!
//! Integration is enabled via spawn-time args / env, never by typing into
//! the PTY — so it doesn't disturb the user's input line. Scripts are
//! (re)written to a temp dir on demand and source the user's own rc first,
//! so user config keeps working.
//!
//! Marks: A = prompt start, B = prompt end / input start, C = pre-exec,
//! D;<exit> = command finished. cmd / WSL are unsupported → returns None
//! and the terminal degrades to plain 0.6 behavior.

use std::fs;
use std::path::PathBuf;

pub struct Integration {
  /// Extra args appended to the shell command line.
  pub extra_args: Vec<String>,
  /// Env vars to set on the child.
  pub envs: Vec<(String, String)>,
}

const PWSH_SCRIPT: &str = r#"# Aether shell integration (OSC 133 / OSC 7)
if ($env:AETHER_SI -ne '1') {
  $env:AETHER_SI = '1'
  $Global:__AetherOrigPrompt = $function:prompt
  function Global:prompt {
    $ec = if ($null -ne $global:LASTEXITCODE) { $global:LASTEXITCODE } elseif ($?) { 0 } else { 1 }
    $e = [char]27
    $p = $ExecutionContext.SessionState.Path.CurrentLocation.Path -replace '\\', '/'
    [Console]::Write("$e]133;D;$ec$e\$e]7;file://localhost/$p$e\$e]133;A$e\")
    $out = ''
    if ($Global:__AetherOrigPrompt) { $out = & $Global:__AetherOrigPrompt }
    if (-not $out) { $out = 'PS ' + $ExecutionContext.SessionState.Path.CurrentLocation.Path + '> ' }
    return "$out$e]133;B$e\"
  }
  if (Get-Module -ListAvailable -Name PSReadLine) {
    function Global:PSConsoleHostReadLine {
      $line = [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($host.Runspace, $ExecutionContext)
      $e = [char]27
      [Console]::Write("$e]133;C$e\")
      return $line
    }
  }
}
"#;

const BASH_SCRIPT: &str = r#"# Aether shell integration (OSC 133 / OSC 7)
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
if [ -z "$AETHER_SI" ]; then
  AETHER_SI=1
  __aether_prompt_cmd() {
    local ec=$?
    printf '\033]133;D;%s\033\\' "$ec"
    printf '\033]7;file://%s%s\033\\' "${HOSTNAME:-localhost}" "$PWD"
    printf '\033]133;A\033\\'
  }
  case ";$PROMPT_COMMAND;" in
    *";__aether_prompt_cmd;"*) ;;
    *) PROMPT_COMMAND="__aether_prompt_cmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
  esac
  PS1="$PS1\[\033]133;B\033\\\\\]"
  PS0='\033]133;C\033\\'"$PS0"
fi
"#;

const ZSH_SCRIPT: &str = r#"# Aether shell integration (OSC 133 / OSC 7)
[ -f "$HOME/.zshenv" ] && source "$HOME/.zshenv"
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc"
if [[ -z "$AETHER_SI" ]]; then
  export AETHER_SI=1
  autoload -Uz add-zsh-hook
  __aether_precmd() {
    print -n "\e]133;D;$?\e\\"
    print -n "\e]7;file://${HOST:-localhost}$PWD\e\\"
    print -n "\e]133;A\e\\"
  }
  __aether_preexec() { print -n "\e]133;C\e\\" }
  add-zsh-hook precmd __aether_precmd
  add-zsh-hook preexec __aether_preexec
  PS1="$PS1%{"$'\e]133;B\e\\'"%}"
fi
"#;

fn script_dir() -> PathBuf {
  std::env::temp_dir().join("aether-shell-integration")
}

fn write_script(name: &str, content: &str) -> Option<PathBuf> {
  let dir = script_dir();
  if fs::create_dir_all(&dir).is_err() {
    return None;
  }
  let path = dir.join(name);
  // Rewrite every launch — cheap, and survives app upgrades changing content
  if fs::write(&path, content).is_err() {
    return None;
  }
  Some(path)
}

fn has_arg(args: &[String], needle: &str) -> bool {
  args.iter().any(|a| a.eq_ignore_ascii_case(needle))
}

/// Prepare spawn-time integration for the given shell. Returns None when the
/// shell is unsupported or the profile args conflict (e.g. explicit -Command).
pub fn prepare(shell_key: &str, shell_path: &str, args: &[String]) -> Option<Integration> {
  let path_lower = shell_path.to_ascii_lowercase();
  let key = shell_key.to_ascii_lowercase();

  // PowerShell (pwsh / Windows PowerShell)
  if key.starts_with("ps") || path_lower.contains("pwsh") || path_lower.contains("powershell") {
    if has_arg(args, "-command") || has_arg(args, "-c") || has_arg(args, "-file") {
      return None;
    }
    let script = write_script("integration.ps1", PWSH_SCRIPT)?;
    return Some(Integration {
      extra_args: vec![
        "-NoExit".into(),
        "-Command".into(),
        format!(". '{}'", script.display()),
      ],
      envs: vec![],
    });
  }

  // bash (NOT wsl — wsl.exe owns its own argv and filesystem namespace)
  if key == "bash" || (path_lower.ends_with("bash") || path_lower.ends_with("bash.exe")) {
    if has_arg(args, "-c") || has_arg(args, "--init-file") || has_arg(args, "--rcfile") {
      return None;
    }
    let script = write_script("integration.bash", BASH_SCRIPT)?;
    return Some(Integration {
      extra_args: vec!["--init-file".into(), script.to_string_lossy().into_owned()],
      envs: vec![],
    });
  }

  // zsh via ZDOTDIR (our .zshrc sources the user's first)
  if key == "zsh" || path_lower.ends_with("zsh") {
    if has_arg(args, "-c") {
      return None;
    }
    let dir = script_dir().join("zdot");
    if fs::create_dir_all(&dir).is_err() {
      return None;
    }
    if fs::write(dir.join(".zshrc"), ZSH_SCRIPT).is_err() {
      return None;
    }
    return Some(Integration {
      extra_args: vec![],
      envs: vec![("ZDOTDIR".into(), dir.to_string_lossy().into_owned())],
    });
  }

  // cmd / wsl / unknown → graceful degradation
  None
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn pwsh_gets_dot_source_args() {
    let i = prepare("ps", "C:/Program Files/PowerShell/7/pwsh.exe", &["-NoLogo".into()]);
    let i = i.expect("pwsh supported");
    assert_eq!(i.extra_args[0], "-NoExit");
    assert_eq!(i.extra_args[1], "-Command");
    assert!(i.extra_args[2].contains("integration.ps1"));
  }

  #[test]
  fn pwsh_with_explicit_command_is_skipped() {
    assert!(prepare("ps", "pwsh.exe", &["-Command".into(), "ls".into()]).is_none());
  }

  #[test]
  fn bash_gets_init_file() {
    let i = prepare("bash", "/usr/bin/bash", &[]).expect("bash supported");
    assert_eq!(i.extra_args[0], "--init-file");
    assert!(i.extra_args[1].contains("integration.bash"));
  }

  #[test]
  fn zsh_gets_zdotdir_env() {
    let i = prepare("zsh", "/bin/zsh", &[]).expect("zsh supported");
    assert!(i.extra_args.is_empty());
    assert_eq!(i.envs[0].0, "ZDOTDIR");
  }

  #[test]
  fn cmd_and_wsl_degrade() {
    assert!(prepare("cmd", "C:/Windows/System32/cmd.exe", &[]).is_none());
    assert!(prepare("wsl:Ubuntu", "C:/Windows/System32/wsl.exe", &[]).is_none());
  }
}
