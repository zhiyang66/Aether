use serde::Serialize;
use std::collections::HashSet;
use std::process::Command;
use which::which;

#[derive(Debug, Clone, Serialize)]
pub struct ShellProfile {
  pub id: String,
  pub name: String,
  pub shell_key: String,
  pub path: String,
  pub args: Vec<String>,
  pub available: bool,
  pub short: String,
  pub desc: String,
}

fn push_if_found(
  out: &mut Vec<ShellProfile>,
  seen: &mut HashSet<String>,
  id: &str,
  name: &str,
  shell_key: &str,
  bin: &str,
  args: Vec<String>,
  short: &str,
  desc: &str,
  extra_paths: &[&str],
) {
  let path = which(bin)
    .ok()
    .map(|p| p.to_string_lossy().to_string())
    .or_else(|| {
      for c in extra_paths {
        if std::path::Path::new(c).exists() {
          return Some((*c).to_string());
        }
      }
      None
    });

  let Some(path) = path else {
    return;
  };

  // de-dup by path+args signature
  let sig = format!("{path}|{}", args.join("\u{1f}"));
  if !seen.insert(sig) {
    return;
  }

  out.push(ShellProfile {
    id: id.to_string(),
    name: name.to_string(),
    shell_key: shell_key.to_string(),
    path,
    args,
    available: true,
    short: short.to_string(),
    desc: desc.to_string(),
  });
}

/// List installed WSL distros (Windows). Names like "Ubuntu-24.04", "Debian".
#[cfg(windows)]
fn list_wsl_distros() -> Vec<String> {
  // Prefer quiet UTF-16 list: `wsl -l -q`
  let output = Command::new("wsl.exe")
    .args(["-l", "-q"])
    .output()
    .or_else(|_| Command::new("wsl").args(["-l", "-q"]).output());

  let Ok(output) = output else {
    return vec![];
  };
  if !output.status.success() && output.stdout.is_empty() {
    return vec![];
  }

  // wsl often emits UTF-16LE
  let text = decode_wsl_stdout(&output.stdout);
  text
    .lines()
    .map(|l| l.trim().trim_start_matches('\u{feff}').to_string())
    .filter(|l| !l.is_empty())
    // skip docker-desktop noise optionally? keep all real distros
    .filter(|l| !l.eq_ignore_ascii_case("docker-desktop-data"))
    .collect()
}

#[cfg(windows)]
fn decode_wsl_stdout(bytes: &[u8]) -> String {
  if bytes.len() >= 2 && bytes.len() % 2 == 0 {
    // heuristic: many NULs → UTF-16LE
    let nul_ratio = bytes.iter().filter(|&&b| b == 0).count() as f32 / bytes.len() as f32;
    if nul_ratio > 0.2 {
      let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
      return String::from_utf16_lossy(&u16s);
    }
  }
  String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(not(windows))]
fn list_wsl_distros() -> Vec<String> {
  vec![]
}

/// Scan only shells actually present on this machine.
pub fn scan_shells() -> Vec<ShellProfile> {
  let mut out = Vec::new();
  let mut seen = HashSet::new();

  // PowerShell 7 — -NoLogo so banner does not look like a hung empty screen
  push_if_found(
    &mut out,
    &mut seen,
    "ps-pwsh",
    "PowerShell 7",
    "ps",
    "pwsh",
    vec!["-NoLogo".into()],
    "PS",
    "pwsh",
    &[
      r"C:\Program Files\PowerShell\7\pwsh.exe",
      r"C:\Program Files\PowerShell\7-preview\pwsh.exe",
    ],
  );

  // Windows PowerShell 5.x
  push_if_found(
    &mut out,
    &mut seen,
    "ps-windows",
    "Windows PowerShell",
    "ps",
    "powershell",
    vec!["-NoLogo".into()],
    "PS",
    "powershell.exe",
    &[r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"],
  );

  // cmd
  push_if_found(
    &mut out,
    &mut seen,
    "cmd",
    "命令提示符",
    "cmd",
    "cmd",
    vec![],
    "C\\",
    "cmd.exe",
    &[r"C:\Windows\System32\cmd.exe"],
  );

  // Git Bash (Windows)
  push_if_found(
    &mut out,
    &mut seen,
    "bash-git",
    "Git Bash",
    "bash",
    "bash",
    vec![],
    "sh",
    "Git Bash",
    &[
      r"C:\Program Files\Git\bin\bash.exe",
      r"C:\Program Files\Git\usr\bin\bash.exe",
    ],
  );

  // system bash / zsh (*nix or if present)
  push_if_found(
    &mut out,
    &mut seen,
    "bash",
    "Bash",
    "bash",
    "bash",
    vec![],
    "sh",
    "/bin/bash",
    &["/bin/bash", "/usr/bin/bash"],
  );

  push_if_found(
    &mut out,
    &mut seen,
    "zsh",
    "Zsh",
    "zsh",
    "zsh",
    vec![],
    "Z",
    "/bin/zsh",
    &["/bin/zsh", "/usr/bin/zsh"],
  );

  // WSL: one entry per installed distro (e.g. Ubuntu-24.04)
  let wsl_path = which("wsl")
    .ok()
    .map(|p| p.to_string_lossy().to_string())
    .or_else(|| {
      let c = r"C:\Windows\System32\wsl.exe";
      if std::path::Path::new(c).exists() {
        Some(c.to_string())
      } else {
        None
      }
    });

  if let Some(wsl) = wsl_path {
    let distros = list_wsl_distros();
    if distros.is_empty() {
      // wsl present but no distro listed — still offer default wsl
      let sig = format!("{wsl}|");
      if seen.insert(sig) {
        out.push(ShellProfile {
          id: "wsl-default".into(),
          name: "WSL（默认发行版）".into(),
          shell_key: "wsl".into(),
          path: wsl.clone(),
          args: vec![],
          available: true,
          short: "WSL".into(),
          desc: "wsl.exe".into(),
        });
      }
    } else {
      for distro in distros {
        let id = format!(
          "wsl-{}",
          distro
            .to_lowercase()
            .replace(|c: char| !c.is_ascii_alphanumeric(), "-")
        );
        let shell_key = format!("wsl:{distro}");
        let args = vec!["-d".into(), distro.clone()];
        let sig = format!("{wsl}|{}", args.join("\u{1f}"));
        if !seen.insert(sig) {
          continue;
        }
        // Friendly name: keep distro string (Ubuntu-24.04 etc.)
        let short = if distro.len() <= 4 {
          distro.clone()
        } else {
          distro.chars().take(3).collect::<String>()
        };
        out.push(ShellProfile {
          id,
          name: format!("WSL · {distro}"),
          shell_key,
          path: wsl.clone(),
          args,
          available: true,
          short,
          desc: format!("wsl -d {distro}"),
        });
      }
    }
  }

  out
}

pub fn resolve_shell(shell_key: &str) -> Result<(String, Vec<String>), String> {
  let list = scan_shells();

  // exact shell_key match (including wsl:Ubuntu-24.04)
  if let Some(p) = list.iter().find(|p| p.shell_key == shell_key && p.available) {
    return Ok((p.path.clone(), p.args.clone()));
  }
  // id match
  if let Some(p) = list.iter().find(|p| p.id == shell_key && p.available) {
    return Ok((p.path.clone(), p.args.clone()));
  }
  // base key: first available of kind
  if let Some(p) = list
    .iter()
    .find(|p| p.available && (p.shell_key == shell_key || p.shell_key.starts_with(&format!("{shell_key}:"))))
  {
    return Ok((p.path.clone(), p.args.clone()));
  }

  // last-resort platform fallbacks (only if scan empty)
  match shell_key {
    "ps" => Ok((
      which("pwsh")
        .or_else(|_| which("powershell"))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| {
          if cfg!(windows) {
            "powershell.exe".into()
          } else {
            "pwsh".into()
          }
        }),
      vec![],
    )),
    "cmd" => Ok((
      which("cmd")
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "cmd.exe".into()),
      vec![],
    )),
    "bash" => Ok((
      which("bash")
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "bash".into()),
      vec![],
    )),
    "zsh" => Ok((
      which("zsh")
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "zsh".into()),
      vec![],
    )),
    k if k == "wsl" || k.starts_with("wsl:") => {
      let path = which("wsl")
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "wsl.exe".into());
      if let Some(distro) = k.strip_prefix("wsl:") {
        Ok((path, vec!["-d".into(), distro.to_string()]))
      } else {
        Ok((path, vec![]))
      }
    }
    _ => Err(format!("未找到可用 Shell: {shell_key}（请重新扫描本机 Shell）")),
  }
}
