mod aether;
mod agent_api;
mod mcp_host;
mod pty_host;
mod recorder;
mod shell_integration;
mod shell_scan;

use pty_host::{PtyHost, SharedPty};
use base64::Engine;
use futures_util::StreamExt;
use serde::Deserialize;
use std::io::Write;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

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

/// Only pass cwd to the child when the path exists as a directory.
/// Invalid / missing cwd makes ConPTY spawn fail on Windows ("启动 Shell 失败").
fn sanitize_cwd(cwd: Option<String>) -> Option<String> {
  let dir = cwd?.trim().to_string();
  if dir.is_empty() {
    return None;
  }
  let p = std::path::Path::new(&dir);
  if p.is_dir() {
    Some(dir)
  } else {
    log::warn!("pty_create: ignoring invalid cwd {dir}");
    None
  }
}

#[tauri::command]
fn pty_create(
  app: tauri::AppHandle,
  host: State<SharedPty>,
  args: PtyCreateArgs,
) -> Result<String, String> {
  let (path, base_args) = if let Some(p) = args.path.filter(|s| !s.is_empty()) {
    (p, args.args.unwrap_or_default())
  } else {
    shell_scan::resolve_shell(&args.shell_key)?
  };
  let cwd = sanitize_cwd(args.cwd);
  let cols = args.cols.unwrap_or(80);
  let rows = args.rows.unwrap_or(24);
  let want_si = args.integration.unwrap_or(true);

  // Try with shell integration first; on spawn failure retry plain shell so a
  // broken integration script never bricks terminal startup.
  if want_si {
    if let Some(si) = shell_integration::prepare(&args.shell_key, &path, &base_args) {
      let mut sh_args = base_args.clone();
      sh_args.extend(si.extra_args);
      match host.create(
        app.clone(),
        &path,
        sh_args,
        si.envs,
        cwd.clone(),
        cols,
        rows,
      ) {
        Ok(id) => return Ok(id),
        Err(e) => {
          log::warn!("pty_create with shell integration failed, retrying plain: {e}");
        }
      }
    }
  }

  host.create(app, &path, base_args, Vec::new(), cwd, cols, rows)
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

/// Fetch update feed JSON via Rust HTTP (avoids WebView CSP / browser UA 403).
/// Only http(s) URLs; response capped at 512 KiB.
/// Prefer github.com/releases/latest (Accept: application/json) over api.github.com
/// so anonymous clients are not hit by the 60 req/h REST API quota.
#[tauri::command]
async fn update_feed_fetch(url: String) -> Result<String, String> {
  let url = url.trim().to_string();
  if !(url.starts_with("https://") || url.starts_with("http://")) {
    return Err("更新源须为 http(s) URL".into());
  }
  // Basic SSRF guard: block obvious local targets
  let lower = url.to_ascii_lowercase();
  if lower.contains("://127.")
    || lower.contains("://localhost")
    || lower.contains("://0.0.0.0")
    || lower.contains("://[::1]")
    || lower.contains("://10.")
    || lower.contains("://192.168.")
    || lower.contains("://169.254.")
  {
    return Err("拒绝访问本地/内网地址".into());
  }

  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(20))
    .redirect(reqwest::redirect::Policy::limited(10))
    .user_agent("Aether-UpdateCheck/1.0 (+https://github.com/zhiyang66/Aether)")
    .build()
    .map_err(|e| format!("HTTP 客户端: {e}"))?;

  // github.com/.../releases/latest returns JSON when Accept is application/json
  // (and does not share api.github.com's strict anonymous rate limit).
  let mut req = client.get(&url).header(reqwest::header::ACCEPT, "application/json");
  if url.contains("api.github.com") {
    req = req
      .header(reqwest::header::ACCEPT, "application/vnd.github+json")
      .header("X-GitHub-Api-Version", "2022-11-28");
  }

  let res = req.send().await.map_err(|e| format!("请求失败: {e}"))?;
  let status = res.status();
  let bytes = res
    .bytes()
    .await
    .map_err(|e| format!("读取响应失败: {e}"))?;
  if bytes.len() > 512 * 1024 {
    return Err("更新源响应过大（>512KB）".into());
  }
  if !status.is_success() {
    let snippet = String::from_utf8_lossy(&bytes);
    let short = snippet.chars().take(200).collect::<String>();
    return Err(format!("HTTP {status}: {short}"));
  }
  String::from_utf8(bytes.to_vec()).map_err(|e| format!("响应非 UTF-8: {e}"))
}

fn validate_update_download_url(raw: &str) -> Result<reqwest::Url, String> {
  let url = reqwest::Url::parse(raw.trim()).map_err(|e| format!("无效下载地址: {e}"))?;
  if url.scheme() != "https" {
    return Err("更新安装包必须使用 HTTPS".into());
  }
  let host = url
    .host_str()
    .ok_or("下载地址缺少主机名")?
    .to_ascii_lowercase();
  if host != "github.com" && !host.ends_with(".githubusercontent.com") {
    return Err("更新安装包必须来自 GitHub Releases".into());
  }
  Ok(url)
}

fn update_installer_name(filename: Option<String>) -> Result<String, String> {
  let name = filename
    .as_deref()
    .and_then(|v| std::path::Path::new(v).file_name())
    .and_then(|v| v.to_str())
    .unwrap_or("Aether-update.exe");
  if name.is_empty() || !name.is_ascii() || name.contains(['/', '\\']) {
    return Err("无效安装包文件名".into());
  }
  let lower = name.to_ascii_lowercase();
  if !(lower.ends_with(".exe") || lower.ends_with(".msi")) {
    return Err("仅支持 .exe 或 .msi Windows 安装包".into());
  }
  Ok(name.to_owned())
}

/// Download a GitHub Releases installer, launch it, then close the current app.
/// The remote feed must provide a direct `downloadUrl`, never a release HTML page.
#[tauri::command]
async fn update_download_and_install(
  app: tauri::AppHandle,
  url: String,
  filename: Option<String>,
) -> Result<(), String> {
  let initial_url = validate_update_download_url(&url)?;
  let url_filename = initial_url
    .path_segments()
    .and_then(|mut segments| segments.next_back())
    .filter(|name| !name.is_empty())
    .map(str::to_owned);
  let name = update_installer_name(filename.or(url_filename))?;
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(10 * 60))
    .redirect(reqwest::redirect::Policy::limited(10))
    .user_agent("Aether-Updater/1.0 (+https://github.com/zhiyang66/Aether)")
    .build()
    .map_err(|e| format!("HTTP 客户端: {e}"))?;
  let response = client
    .get(initial_url)
    .send()
    .await
    .map_err(|e| format!("下载失败: {e}"))?;
  validate_update_download_url(response.url().as_str())?;
  if !response.status().is_success() {
    return Err(format!("下载失败: HTTP {}", response.status()));
  }
  const MAX_INSTALLER_SIZE: u64 = 512 * 1024 * 1024;
  if response.content_length().is_some_and(|size| size > MAX_INSTALLER_SIZE) {
    return Err("安装包过大（超过 512 MB）".into());
  }
  let path = std::env::temp_dir().join(format!("aether-update-{}-{name}", uuid::Uuid::new_v4()));
  let part_path = path.with_extension(format!("{}.part", path.extension().and_then(|v| v.to_str()).unwrap_or("download")));
  let total = response.content_length();
  let _ = app.emit("update://download-progress", serde_json::json!({
    "downloaded": 0_u64,
    "total": total,
    "percent": 0_u8,
  }));
  let mut stream = response.bytes_stream();
  let mut downloaded = 0_u64;
  {
    let mut file = std::fs::File::create(&part_path)
      .map_err(|e| format!("创建临时安装包失败: {e}"))?;
    while let Some(chunk) = stream.next().await {
      let chunk = chunk.map_err(|e| format!("读取安装包失败: {e}"))?;
      downloaded = downloaded.saturating_add(chunk.len() as u64);
      if downloaded > MAX_INSTALLER_SIZE {
        return Err("安装包过大（超过 512 MB）".into());
      }
      file.write_all(&chunk).map_err(|e| format!("写入安装包失败: {e}"))?;
      let percent = total.map(|size| ((downloaded.saturating_mul(100) / size.max(1)).min(100)) as u8);
      let _ = app.emit("update://download-progress", serde_json::json!({
        "downloaded": downloaded,
        "total": total,
        "percent": percent,
      }));
    }
    file.flush().map_err(|e| format!("保存安装包失败: {e}"))?;
    file.sync_all().map_err(|e| format!("保存安装包失败: {e}"))?;
  }
  std::fs::rename(&part_path, &path).map_err(|e| format!("完成安装包下载失败: {e}"))?;

  let extension = path.extension().and_then(|v| v.to_str()).unwrap_or_default();
  let mut command = if extension.eq_ignore_ascii_case("msi") {
    let mut command = std::process::Command::new("msiexec");
    command.arg("/i").arg(&path);
    command
  } else {
    std::process::Command::new(&path)
  };
  let mut launch_error = None;
  for attempt in 0..5 {
    match command.spawn() {
      Ok(_) => {
        launch_error = None;
        break;
      }
      Err(e) if e.raw_os_error() == Some(32) && attempt < 4 => {
        launch_error = Some(e);
        std::thread::sleep(std::time::Duration::from_millis(200));
      }
      Err(e) => return Err(format!("无法启动安装程序: {e}")),
    }
  }
  if let Some(e) = launch_error {
    return Err(format!("无法启动安装程序: {e}"));
  }
  app.exit(0);
  Ok(())
}

#[tauri::command]
fn save_pasted_image(
  app: tauri::AppHandle,
  mime_type: String,
  data_base64: String,
) -> Result<String, String> {
  let extension = match mime_type.to_ascii_lowercase().as_str() {
    "image/png" => "png",
    "image/jpeg" => "jpg",
    "image/webp" => "webp",
    "image/gif" => "gif",
    _ => return Err("仅支持 PNG、JPEG、WebP 或 GIF 图片".into()),
  };
  if data_base64.len() > 12 * 1024 * 1024 {
    return Err("图片须小于 8 MB".into());
  }
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(data_base64)
    .map_err(|_| "图片数据无效")?;
  if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
    return Err("图片须小于 8 MB".into());
  }
  let dir = app.path().app_data_dir().map_err(|e| format!("无法定位附件目录: {e}"))?.join("attachments");
  std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建附件目录: {e}"))?;
  let path = dir.join(format!("paste-{}.{}", uuid::Uuid::new_v4(), extension));
  std::fs::write(&path, bytes).map_err(|e| format!("保存图片失败: {e}"))?;
  Ok(path.to_string_lossy().into_owned())
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
      update_feed_fetch,
      update_download_and_install,
      save_pasted_image,
      mcp_host::mcp_connect,
      mcp_host::mcp_disconnect,
      mcp_host::mcp_status,
      mcp_host::mcp_call_tool,
      aether::skills_list,
      aether::skills_dir_path,
      aether::skill_write,
      aether::skill_delete,
      aether::aether_config_read,
      aether::aether_config_write
    ])
    .on_window_event(|_, event| {
      if let tauri::WindowEvent::Destroyed = event {
        mcp_host::shutdown_all();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
