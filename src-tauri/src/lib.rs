mod agent_api;
mod mcp_host;
mod pty_host;
mod recorder;
mod shell_integration;
mod shell_scan;

use pty_host::{PtyHost, SharedPty};
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
struct PtyCreateArgs {
  shell_key: String,
  cwd: Option<String>,
  cols: Option<u16>,
  rows: Option<u16>,
  path: Option<String>,
  args: Option<Vec<String>>,
  /// Enable OSC 133/7 shell integration at spawn (default true)
  integration: Option<bool>,
}

#[tauri::command]
fn pty_create(
  app: tauri::AppHandle,
  host: State<SharedPty>,
  args: PtyCreateArgs,
) -> Result<String, String> {
  let (path, mut sh_args) = if let Some(p) = args.path.filter(|s| !s.is_empty()) {
    (p, args.args.unwrap_or_default())
  } else {
    shell_scan::resolve_shell(&args.shell_key)?
  };
  let mut envs: Vec<(String, String)> = Vec::new();
  if args.integration.unwrap_or(true) {
    if let Some(si) = shell_integration::prepare(&args.shell_key, &path, &sh_args) {
      sh_args.extend(si.extra_args);
      envs.extend(si.envs);
    }
  }
  host.create(
    app,
    &path,
    sh_args,
    envs,
    args.cwd,
    args.cols.unwrap_or(80),
    args.rows.unwrap_or(24),
  )
}

#[tauri::command]
fn pty_write(host: State<SharedPty>, id: String, data: String) -> Result<(), String> {
  host.write(&id, data.as_bytes())
}

#[tauri::command]
fn pty_resize(host: State<SharedPty>, id: String, cols: u16, rows: u16) -> Result<(), String> {
  host.resize(&id, cols, rows)
}

#[tauri::command]
fn pty_close(host: State<SharedPty>, id: String) -> Result<(), String> {
  host.close(&id)
}

#[tauri::command]
fn shell_scan() -> Vec<shell_scan::ShellProfile> {
  shell_scan::scan_shells()
}

/// Read ~/.ssh/config for the hosts import flow (1.0). Missing file → "".
#[tauri::command]
fn read_ssh_config() -> String {
  dirs::home_dir()
    .map(|h| h.join(".ssh").join("config"))
    .and_then(|p| std::fs::read_to_string(p).ok())
    .unwrap_or_default()
}

/// The single directory Aether reads/writes session recordings under.
fn recordings_dir() -> Result<std::path::PathBuf, String> {
  Ok(dirs::home_dir().ok_or("无法定位用户目录")?.join("aether-recordings"))
}

/// Start recording a PTY session to an asciinema cast v2 file.
/// Returns the file path (auto-generated under ~/aether-recordings).
#[tauri::command]
fn pty_record_start(id: String, cols: Option<u16>, rows: Option<u16>) -> Result<String, String> {
  let dir = recordings_dir()?;
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建录像目录失败: {e}"))?;
  let stamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  // Include the PTY id so two recordings started in the same second can't
  // collide onto one file (which would interleave/corrupt both casts).
  let safe_id: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
  let path = dir.join(format!("aether-{stamp}-{safe_id}.cast"));
  let p = path.to_string_lossy().to_string();
  recorder::start(&id, &p, cols.unwrap_or(80), rows.unwrap_or(24))?;
  Ok(p)
}

/// Stop recording; returns the cast path if one was active.
#[tauri::command]
fn pty_record_stop(id: String) -> Option<String> {
  recorder::stop(&id)
}

#[tauri::command]
fn pty_record_status(id: String) -> bool {
  recorder::is_recording(&id)
}

/// Read a .cast file for playback (size-capped, confined to the recordings dir).
#[tauri::command]
fn read_cast_file(path: String) -> Result<String, String> {
  const MAX: u64 = 8 * 1024 * 1024;
  // Confine to ~/aether-recordings: canonicalize both sides so `..`, symlinks
  // and absolute paths can't turn this into an arbitrary-file-read primitive
  // (e.g. reading ~/.ssh/id_rsa or .env through the IPC bridge).
  let dir = recordings_dir()?
    .canonicalize()
    .map_err(|e| format!("录像目录不可用: {e}"))?;
  let requested = std::path::Path::new(&path)
    .canonicalize()
    .map_err(|e| format!("读取失败: {e}"))?;
  if !requested.starts_with(&dir) {
    return Err("拒绝：只能读取录像目录内的文件".into());
  }
  if requested.extension().and_then(|e| e.to_str()) != Some("cast") {
    return Err("拒绝：只能读取 .cast 录像文件".into());
  }
  let meta = std::fs::metadata(&requested).map_err(|e| format!("读取失败: {e}"))?;
  if meta.len() > MAX {
    return Err(format!("录像过大（{} MB > 8 MB）", meta.len() / 1024 / 1024));
  }
  std::fs::read_to_string(&requested).map_err(|e| format!("读取失败: {e}"))
}

/// 1.0 项目级上下文：从 cwd 向上查找 AETHER.md（到 git root 为止）。
#[tauri::command]
fn project_context_read(cwd: String) -> Option<(String, String)> {
  const MAX_BYTES: usize = 8 * 1024;
  let mut dir = std::path::PathBuf::from(cwd);
  if !dir.is_dir() {
    return None;
  }
  for _ in 0..12 {
    let candidate = dir.join("AETHER.md");
    if candidate.is_file() {
      if let Ok(mut content) = std::fs::read_to_string(&candidate) {
        if content.len() > MAX_BYTES {
          let mut cut = MAX_BYTES;
          while cut > 0 && !content.is_char_boundary(cut) {
            cut -= 1;
          }
          content.truncate(cut);
          content.push_str("\n…[已截断]");
        }
        return Some((candidate.to_string_lossy().to_string(), content));
      }
    }
    let at_git_root = dir.join(".git").exists();
    if at_git_root {
      return None;
    }
    if !dir.pop() {
      return None;
    }
  }
  None
}

#[tauri::command]
async fn agent_models_list(req: agent_api::ModelsListRequest) -> Result<Vec<agent_api::ModelInfo>, String> {
  agent_api::list_models(req).await
}

#[tauri::command]
async fn agent_chat(app: tauri::AppHandle, req: agent_api::ChatRequest) -> Result<(), String> {
  agent_api::chat_stream(app, req).await
}

#[tauri::command]
fn agent_chat_cancel(stream_id: String) -> bool {
  agent_api::cancel_stream(&stream_id)
}

/// One non-stream chat round that may return tool_calls (for agent tool loop).
/// Deprecated since 0.7 — use agent_chat_stream_tools (cancellable, streaming).
#[tauri::command]
async fn agent_chat_tools(
  req: agent_api::ToolChatRequest,
) -> Result<agent_api::ToolChatResponse, String> {
  agent_api::chat_with_tools(req).await
}

/// 0.7 kernel: one STREAMING chat round with tool-call support.
/// Text/thinking stream via `agent://stream`; tool calls come back in the
/// result. Registered in STREAM_CANCEL — Stop interrupts mid-flight.
#[tauri::command]
async fn agent_chat_stream_tools(
  app: tauri::AppHandle,
  req: agent_api::ToolStreamRequest,
) -> Result<agent_api::ToolChatResponse, String> {
  agent_api::chat_stream_tools(app, req).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let pty = Arc::new(PtyHost::new());
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .manage(pty)
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      pty_create,
      pty_write,
      pty_resize,
      pty_close,
      shell_scan,
      read_ssh_config,
      pty_record_start,
      pty_record_stop,
      pty_record_status,
      read_cast_file,
      project_context_read,
      agent_models_list,
      agent_chat,
      agent_chat_cancel,
      agent_chat_tools,
      agent_chat_stream_tools,
      mcp_host::mcp_connect,
      mcp_host::mcp_disconnect,
      mcp_host::mcp_status,
      mcp_host::mcp_call_tool
    ])
    .on_window_event(|_, event| {
      if let tauri::WindowEvent::Destroyed = event {
        mcp_host::shutdown_all();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
