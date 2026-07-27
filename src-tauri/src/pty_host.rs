use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct PtySession {
  pub master: Box<dyn MasterPty + Send>,
  pub writer: Box<dyn Write + Send>,
  /// Keep child process and slave side alive for the session lifetime.
  pub _child: Box<dyn Child + Send + Sync>,
  pub _slave: Box<dyn portable_pty::SlavePty + Send>,
}

pub struct PtyHost {
  sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyHost {
  pub fn new() -> Self {
    Self {
      sessions: Mutex::new(HashMap::new()),
    }
  }

  pub fn create(
    &self,
    app: AppHandle,
    shell: &str,
    args: Vec<String>,
    envs: Vec<(String, String)>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
  ) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
      .openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
      })
      .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(shell);
    for a in args {
      cmd.arg(a);
    }
    if let Some(dir) = cwd {
      if !dir.is_empty() {
        cmd.cwd(dir);
      }
    }
    cmd.env("TERM", "xterm-256color");
    // Force interactive-ish colors where supported
    cmd.env("COLORTERM", "truecolor");
    // Keep the child attached to *this* ConPTY, not the Windows Terminal
    // "default terminal" reparent path (which flashes WT and restores sessions).
    #[cfg(windows)]
    {
      cmd.env("TERM_PROGRAM", "aether");
      // WT respects this to avoid treating the process as a "new console session"
      // that should open a visible WT window with "restore previous session".
      cmd.env("WT_SESSION", "");
      cmd.env("WT_PROFILE_ID", "");
    }
    for (k, v) in envs {
      cmd.env(k, v);
    }

    let child = pair
      .slave
      .spawn_command(cmd)
      .map_err(|e| format!("启动 Shell 失败 ({shell}): {e}"))?;

    let mut reader = pair
      .master
      .try_clone_reader()
      .map_err(|e| e.to_string())?;
    let writer = pair
      .master
      .take_writer()
      .map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let id_clone = id.clone();
    let app_clone = app.clone();

    thread::spawn(move || {
      let mut buf = [0u8; 8192];
      loop {
        match reader.read(&mut buf) {
          Ok(0) => {
            let _ = app_clone.emit(
              "pty://exit",
              PtyExitEvent {
                id: id_clone.clone(),
                code: None,
              },
            );
            break;
          }
          Ok(n) => {
            let chunk = buf[..n].to_vec();
            crate::recorder::record_output(&id_clone, &chunk);
            let _ = app_clone.emit(
              "pty://data",
              PtyDataEvent {
                id: id_clone.clone(),
                data: chunk,
              },
            );
          }
          Err(_) => {
            let _ = app_clone.emit(
              "pty://exit",
              PtyExitEvent {
                id: id_clone.clone(),
                code: None,
              },
            );
            break;
          }
        }
      }
    });

    self.sessions.lock().insert(
      id.clone(),
      PtySession {
        master: pair.master,
        writer,
        _child: child,
        _slave: pair.slave,
      },
    );
    Ok(id)
  }

  pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
    let mut map = self.sessions.lock();
    let sess = map.get_mut(id).ok_or_else(|| "pty not found".to_string())?;
    sess.writer.write_all(data).map_err(|e| e.to_string())?;
    sess.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let map = self.sessions.lock();
    let sess = map.get(id).ok_or_else(|| "pty not found".to_string())?;
    crate::recorder::record_resize(id, cols, rows);
    sess.master
      .resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
      })
      .map_err(|e| e.to_string())
  }

  pub fn close(&self, id: &str) -> Result<(), String> {
    let mut map = self.sessions.lock();
    map.remove(id);
    crate::recorder::stop(id);
    Ok(())
  }
}

#[derive(Clone, Serialize)]
pub struct PtyDataEvent {
  pub id: String,
  pub data: Vec<u8>,
}

#[derive(Clone, Serialize)]
pub struct PtyExitEvent {
  pub id: String,
  pub code: Option<i32>,
}

pub type SharedPty = Arc<PtyHost>;
