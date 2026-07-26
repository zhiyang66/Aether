//! `~/.aether` configuration home — the single directory Aether stores user
//! config under, mirroring `~/.codex` / `~/.claude`:
//!   - `~/.aether/skills/<id>/SKILL.md`  — Agent capability skills (files, not code)
//!   - `~/.aether/config.json`           — persisted settings (authoritative source)
//!
//! Every command here is confined to `~/.aether` and takes NO path input, so it
//! can't be turned into an arbitrary file read/write primitive over the IPC
//! bridge. Sizes and counts are capped.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

fn aether_dir() -> Result<PathBuf, String> {
  Ok(dirs::home_dir().ok_or("无法定位用户目录")?.join(".aether"))
}

fn skills_dir() -> Result<PathBuf, String> {
  Ok(aether_dir()?.join("skills"))
}

fn config_path() -> Result<PathBuf, String> {
  Ok(aether_dir()?.join("config.json"))
}

/// Built-in skills embedded at compile time from the repo `skills/<id>/SKILL.md`
/// files (the source of truth). Seeded to disk on first run; thereafter the user
/// owns the on-disk copies.
const BUILTIN_SKILLS: &[(&str, &str)] = &[
  ("tools", include_str!("../../skills/tools/SKILL.md")),
  ("workbench", include_str!("../../skills/workbench/SKILL.md")),
  ("app-control", include_str!("../../skills/app-control/SKILL.md")),
  ("mcp-setup", include_str!("../../skills/mcp-setup/SKILL.md")),
  ("ssh-hosts", include_str!("../../skills/ssh-hosts/SKILL.md")),
  ("utilities", include_str!("../../skills/utilities/SKILL.md")),
  ("actions", include_str!("../../skills/actions/SKILL.md")),
  ("interactive-cli", include_str!("../../skills/interactive-cli/SKILL.md")),
  ("skill-creator", include_str!("../../skills/skill-creator/SKILL.md")),
];

#[derive(Serialize)]
pub struct SkillFile {
  id: String,
  title: String,
  category: String,
  summary: String,
  body: String,
  builtin: bool,
}

/// Split `SKILL.md` text into (frontmatter map, body). Frontmatter is the block
/// between the first two `---` fence lines; everything after is the body. CRLF
/// and a leading BOM are tolerated. No frontmatter → whole text is the body.
fn parse_frontmatter(text: &str) -> (HashMap<String, String>, String) {
  let mut map = HashMap::new();
  let normalized = text.replace("\r\n", "\n");
  let trimmed = normalized.trim_start_matches('\u{feff}');
  if let Some(rest) = trimmed.strip_prefix("---\n") {
    if let Some(end) = rest.find("\n---") {
      let fm = &rest[..end];
      // Body begins after the closing fence line ("\n---" + rest of that line).
      let after = &rest[end + 4..];
      let after = after.strip_prefix('\n').unwrap_or(after);
      for line in fm.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
          continue;
        }
        if let Some(idx) = line.find(':') {
          let key = line[..idx].trim().to_string();
          let val = line[idx + 1..].trim().to_string();
          if !key.is_empty() {
            map.insert(key, val);
          }
        }
      }
      return (map, after.trim().to_string());
    }
  }
  (map, trimmed.trim().to_string())
}

/// Seed built-ins to `~/.aether/skills/` only when that directory does not yet
/// exist. If the user later deletes a skill, it is NOT re-created (delete the
/// whole `skills/` dir + restart to restore defaults).
fn seed_if_absent() -> Result<PathBuf, String> {
  let dir = skills_dir()?;
  if !dir.exists() {
    for (id, contents) in BUILTIN_SKILLS {
      let sub = dir.join(id);
      std::fs::create_dir_all(&sub).map_err(|e| format!("创建 skill 目录失败: {e}"))?;
      std::fs::write(sub.join("SKILL.md"), contents)
        .map_err(|e| format!("写入内置 skill 失败: {e}"))?;
    }
  }
  Ok(dir)
}

/// List every `~/.aether/skills/<id>/SKILL.md` (built-ins seeded on first run).
#[tauri::command]
pub fn skills_list() -> Result<Vec<SkillFile>, String> {
  const MAX_FILE: u64 = 64 * 1024;
  const MAX_COUNT: usize = 100;
  let dir = seed_if_absent()?;

  let builtin_ids: HashSet<&str> = BUILTIN_SKILLS.iter().map(|(id, _)| *id).collect();
  let builtin_order: HashMap<&str, usize> = BUILTIN_SKILLS
    .iter()
    .enumerate()
    .map(|(i, (id, _))| (*id, i))
    .collect();

  let mut out: Vec<SkillFile> = Vec::new();
  let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取 skill 目录失败: {e}"))?;
  for entry in entries.flatten() {
    if out.len() >= MAX_COUNT {
      break;
    }
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }
    let dir_name = match path.file_name().and_then(|n| n.to_str()) {
      Some(n) => n.to_string(),
      None => continue,
    };
    let md = path.join("SKILL.md");
    let meta = match std::fs::metadata(&md) {
      Ok(m) => m,
      Err(_) => continue,
    };
    if !meta.is_file() || meta.len() > MAX_FILE {
      continue;
    }
    let text = match std::fs::read_to_string(&md) {
      Ok(t) => t,
      Err(_) => continue,
    };
    let (fm, body) = parse_frontmatter(&text);
    let id = fm
      .get("name")
      .filter(|s| !s.is_empty())
      .cloned()
      .unwrap_or(dir_name);
    let title = fm
      .get("title")
      .filter(|s| !s.is_empty())
      .cloned()
      .unwrap_or_else(|| id.clone());
    out.push(SkillFile {
      builtin: builtin_ids.contains(id.as_str()),
      category: fm.get("category").cloned().unwrap_or_default(),
      summary: fm.get("description").cloned().unwrap_or_default(),
      id,
      title,
      body,
    });
  }

  // Built-ins first (in defined order), user skills after (alphabetical).
  out.sort_by(|a, b| {
    match (
      builtin_order.get(a.id.as_str()).copied(),
      builtin_order.get(b.id.as_str()).copied(),
    ) {
      (Some(x), Some(y)) => x.cmp(&y),
      (Some(_), None) => std::cmp::Ordering::Less,
      (None, Some(_)) => std::cmp::Ordering::Greater,
      (None, None) => a.id.cmp(&b.id),
    }
  });
  Ok(out)
}

/// Absolute path of the skills directory (for display in Settings).
#[tauri::command]
pub fn skills_dir_path() -> Result<String, String> {
  Ok(skills_dir()?.to_string_lossy().to_string())
}

/// Validate a skill id so it can only ever be a single directory name under
/// `~/.aether/skills/` — no path separators, traversal, or exotic characters.
fn valid_skill_id(id: &str) -> Result<String, String> {
  let id = id.trim();
  if id.is_empty() || id.len() > 64 {
    return Err("skill id 需 1–64 字符".into());
  }
  if !id
    .chars()
    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
  {
    return Err("skill id 只能含小写字母、数字、连字符".into());
  }
  if id.starts_with('-') || id.ends_with('-') {
    return Err("skill id 不能以连字符开头或结尾".into());
  }
  Ok(id.to_string())
}

/// Write (create or overwrite) `~/.aether/skills/<id>/SKILL.md`. The id is
/// validated to a safe single directory name; contents are size-capped.
#[tauri::command]
pub fn skill_write(id: String, contents: String) -> Result<String, String> {
  let id = valid_skill_id(&id)?;
  if contents.len() > 64 * 1024 {
    return Err("SKILL.md 过大（>64KB）".into());
  }
  let dir = skills_dir()?.join(&id);
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建 skill 目录失败: {e}"))?;
  let md = dir.join("SKILL.md");
  std::fs::write(&md, contents).map_err(|e| format!("写入 SKILL.md 失败: {e}"))?;
  Ok(md.to_string_lossy().to_string())
}

/// Delete `~/.aether/skills/<id>/` (the whole skill directory).
#[tauri::command]
pub fn skill_delete(id: String) -> Result<(), String> {
  let id = valid_skill_id(&id)?;
  let dir = skills_dir()?.join(&id);
  if dir.exists() {
    std::fs::remove_dir_all(&dir).map_err(|e| format!("删除 skill 失败: {e}"))?;
  }
  Ok(())
}

/// Read `~/.aether/config.json` (authoritative settings). Missing file → None.
#[tauri::command]
pub fn aether_config_read() -> Result<Option<String>, String> {
  let path = config_path()?;
  match std::fs::metadata(&path) {
    Ok(m) => {
      if m.len() > 1024 * 1024 {
        return Err("config.json 过大（>1MB）".into());
      }
    }
    Err(_) => return Ok(None),
  }
  std::fs::read_to_string(&path)
    .map(Some)
    .map_err(|e| format!("读取 config.json 失败: {e}"))
}

/// Write `~/.aether/config.json`. Creates `~/.aether` if needed.
#[tauri::command]
pub fn aether_config_write(contents: String) -> Result<(), String> {
  if contents.len() > 1024 * 1024 {
    return Err("配置过大（>1MB）".into());
  }
  let dir = aether_dir()?;
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建 .aether 目录失败: {e}"))?;
  std::fs::write(config_path()?, contents).map_err(|e| format!("写入 config.json 失败: {e}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_frontmatter_and_body() {
    let text = "---\nname: demo\ntitle: 演示\ncategory: 测试\ndescription: 一句话\n---\n\n正文第一行\n正文第二行\n";
    let (fm, body) = parse_frontmatter(text);
    assert_eq!(fm.get("name").unwrap(), "demo");
    assert_eq!(fm.get("title").unwrap(), "演示");
    assert_eq!(fm.get("category").unwrap(), "测试");
    assert_eq!(fm.get("description").unwrap(), "一句话");
    assert!(body.starts_with("正文第一行"));
    assert!(body.contains("正文第二行"));
  }

  #[test]
  fn tolerates_crlf_and_missing_fields() {
    let text = "---\r\nname: x\r\n---\r\nbody here";
    let (fm, body) = parse_frontmatter(text);
    assert_eq!(fm.get("name").unwrap(), "x");
    assert!(fm.get("title").is_none());
    assert_eq!(body, "body here");
  }

  #[test]
  fn value_may_contain_colons() {
    let text = "---\ndescription: 读/改 设置：先查后改\n---\nbody";
    let (fm, _) = parse_frontmatter(text);
    assert_eq!(fm.get("description").unwrap(), "读/改 设置：先查后改");
  }

  #[test]
  fn no_frontmatter_returns_whole_as_body() {
    let text = "just body, no fence";
    let (fm, body) = parse_frontmatter(text);
    assert!(fm.is_empty());
    assert_eq!(body, "just body, no fence");
  }

  #[test]
  fn skill_id_validation_blocks_traversal() {
    assert!(valid_skill_id("my-skill").is_ok());
    assert!(valid_skill_id("skill1").is_ok());
    assert!(valid_skill_id("").is_err());
    assert!(valid_skill_id("../evil").is_err());
    assert!(valid_skill_id("a/b").is_err());
    assert!(valid_skill_id("UPPER").is_err());
    assert!(valid_skill_id("-lead").is_err());
    assert!(valid_skill_id("trail-").is_err());
  }

  #[test]
  fn all_builtins_embed_and_parse() {
    for (id, contents) in BUILTIN_SKILLS {
      let (fm, body) = parse_frontmatter(contents);
      assert_eq!(
        fm.get("name").map(|s| s.as_str()),
        Some(*id),
        "frontmatter name must match dir id for {id}"
      );
      assert!(
        !fm.get("description").cloned().unwrap_or_default().is_empty(),
        "{id} needs a description"
      );
      assert!(!body.trim().is_empty(), "{id} needs a body");
    }
  }
}
