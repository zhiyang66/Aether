mod agent_api;
mod pty_host;
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
}

#[tauri::command]
fn pty_create(
  app: tauri::AppHandle,
  host: State<SharedPty>,
  args: PtyCreateArgs,
) -> Result<String, String> {
  let (path, sh_args) = if let Some(p) = args.path.filter(|s| !s.is_empty()) {
    (p, args.args.unwrap_or_default())
  } else {
    shell_scan::resolve_shell(&args.shell_key)?
  };
  host.create(
    app,
    &path,
    sh_args,
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
fn pty_write_bytes(host: State<SharedPty>, id: String, data: Vec<u8>) -> Result<(), String> {
  host.write(&id, &data)
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
#[tauri::command]
async fn agent_chat_tools(
  req: agent_api::ToolChatRequest,
) -> Result<agent_api::ToolChatResponse, String> {
  agent_api::chat_with_tools(req).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let pty = Arc::new(PtyHost::new());
  tauri::Builder::default()
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
      pty_write_bytes,
      pty_resize,
      pty_close,
      shell_scan,
      agent_models_list,
      agent_chat,
      agent_chat_cancel,
      agent_chat_tools
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
