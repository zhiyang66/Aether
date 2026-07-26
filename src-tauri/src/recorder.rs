//! Session recording (1.0): asciinema cast v2 written on the Rust side so the
//! frontend never accumulates big buffers. The PTY reader thread calls
//! `record_output` for every chunk; start/stop is per PTY id.

use parking_lot::Mutex;
use serde_json::json;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

/// Number of active recordings. Lets the hot PTY-output path skip the global
/// lock + JSON allocation entirely in the common case (nothing recording).
static ACTIVE: AtomicUsize = AtomicUsize::new(0);

struct Recording {
    file: BufWriter<File>,
    started: Instant,
    path: String,
}

static RECORDINGS: Mutex<Option<HashMap<String, Recording>>> = Mutex::new(None);

fn with_map<R>(f: impl FnOnce(&mut HashMap<String, Recording>) -> R) -> R {
    let mut guard = RECORDINGS.lock();
    let map = guard.get_or_insert_with(HashMap::new);
    f(map)
}

/// cast v2 header line.
fn header(cols: u16, rows: u16) -> String {
    json!({
        "version": 2,
        "width": cols,
        "height": rows,
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        "env": {"TERM": "xterm-256color", "SHELL": ""}
    })
    .to_string()
}

/// Event line `[t, code, data]`.
fn event_line(t: f64, code: &str, data: &str) -> String {
    json!([(t * 1000.0).round() / 1000.0, code, data]).to_string()
}

pub fn start(pty_id: &str, path: &str, cols: u16, rows: u16) -> Result<(), String> {
    let file = File::create(path).map_err(|e| format!("创建录像文件失败: {e}"))?;
    let mut w = BufWriter::new(file);
    writeln!(w, "{}", header(cols, rows)).map_err(|e| e.to_string())?;
    with_map(|map| {
        let prev = map.insert(
            pty_id.to_string(),
            Recording {
                file: w,
                started: Instant::now(),
                path: path.to_string(),
            },
        );
        if prev.is_none() {
            ACTIVE.fetch_add(1, Ordering::Relaxed);
        }
    });
    Ok(())
}

/// Stop and return the file path (None if not recording).
pub fn stop(pty_id: &str) -> Option<String> {
    with_map(|map| {
        map.remove(pty_id).map(|mut r| {
            ACTIVE.fetch_sub(1, Ordering::Relaxed);
            let _ = r.file.flush();
            r.path
        })
    })
}

pub fn is_recording(pty_id: &str) -> bool {
    with_map(|map| map.contains_key(pty_id))
}

/// Called from the PTY reader thread for every output chunk. No-op when idle.
pub fn record_output(pty_id: &str, data: &[u8]) {
    if ACTIVE.load(Ordering::Relaxed) == 0 {
        return;
    }
    with_map(|map| {
        if let Some(r) = map.get_mut(pty_id) {
            let t = r.started.elapsed().as_secs_f64();
            let text = String::from_utf8_lossy(data);
            let line = event_line(t, "o", &text);
            let _ = writeln!(r.file, "{line}");
        }
    });
}

/// Resize events keep playback geometry honest.
pub fn record_resize(pty_id: &str, cols: u16, rows: u16) {
    if ACTIVE.load(Ordering::Relaxed) == 0 {
        return;
    }
    with_map(|map| {
        if let Some(r) = map.get_mut(pty_id) {
            let t = r.started.elapsed().as_secs_f64();
            let line = event_line(t, "r", &format!("{cols}x{rows}"));
            let _ = writeln!(r.file, "{line}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_is_valid_cast_v2() {
        let h: serde_json::Value = serde_json::from_str(&header(120, 30)).unwrap();
        assert_eq!(h["version"], 2);
        assert_eq!(h["width"], 120);
        assert_eq!(h["height"], 30);
        assert!(h["timestamp"].as_u64().unwrap() > 0);
    }

    #[test]
    fn event_lines_are_json_arrays() {
        let v: serde_json::Value =
            serde_json::from_str(&event_line(1.23456, "o", "hi\r\n")).unwrap();
        assert_eq!(v[0], 1.235);
        assert_eq!(v[1], "o");
        assert_eq!(v[2], "hi\r\n");
    }

    #[test]
    fn full_recording_roundtrip() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("aether-test-{}.cast", uuid::Uuid::new_v4()));
        let p = path.to_string_lossy().to_string();
        start("test-pty", &p, 80, 24).unwrap();
        assert!(is_recording("test-pty"));
        record_output("test-pty", b"hello \x1b[32mworld\x1b[0m\r\n");
        record_resize("test-pty", 100, 30);
        let out = stop("test-pty").unwrap();
        assert_eq!(out, p);
        assert!(!is_recording("test-pty"));

        let content = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 3);
        let head: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(head["version"], 2);
        let ev: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(ev[1], "o");
        assert!(ev[2].as_str().unwrap().contains("world"));
        let rs: serde_json::Value = serde_json::from_str(lines[2]).unwrap();
        assert_eq!(rs[1], "r");
        assert_eq!(rs[2], "100x30");
        let _ = std::fs::remove_file(&path);
    }
}
