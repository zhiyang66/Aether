//! MCP (Model Context Protocol) client runtime — 1.0.
//!
//! Supports stdio transport (local process, newline-delimited JSON-RPC) and a
//! basic streamable-HTTP transport (POST JSON-RPC; JSON or SSE response).
//! Server processes are kept in a global registry and killed on app exit.
//! Tool calls have a hard timeout and an output size cap so a misbehaving
//! server cannot hang the loop or flood the model context.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

const CALL_TIMEOUT_SECS: u64 = 30;
const INIT_TIMEOUT_SECS: u64 = 15;
/// Cap tool output before it reaches the model context.
const MAX_RESULT_BYTES: usize = 24 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    /// "stdio" | "http"
    pub transport: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;

struct StdioProc {
    child: Child,
    stdin: ChildStdin,
    pending: Pending,
    next_id: AtomicU64,
}

impl StdioProc {
    fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().insert(id, tx);
        let msg = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let line = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        self.stdin
            .write_all(format!("{line}\n").as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("MCP stdin 写入失败: {e}"))?;
        let resp = rx
            .recv_timeout(timeout)
            .map_err(|_| format!("MCP 响应超时（{}s）", timeout.as_secs()));
        self.pending.lock().remove(&id);
        resp
    }

    fn notify(&mut self, method: &str, params: Value) {
        let msg = json!({"jsonrpc": "2.0", "method": method, "params": params});
        if let Ok(line) = serde_json::to_string(&msg) {
            let _ = self
                .stdin
                .write_all(format!("{line}\n").as_bytes())
                .and_then(|_| self.stdin.flush());
        }
    }
}

enum Server {
    Stdio(StdioProc),
    Http { url: String },
}

static SERVERS: Mutex<Option<HashMap<String, Server>>> = Mutex::new(None);

fn with_servers<R>(f: impl FnOnce(&mut HashMap<String, Server>) -> R) -> R {
    let mut guard = SERVERS.lock();
    let map = guard.get_or_insert_with(HashMap::new);
    f(map)
}

/// Kill every stdio child (app exit).
pub fn shutdown_all() {
    with_servers(|map| {
        for (_, server) in map.drain() {
            if let Server::Stdio(mut p) = server {
                let _ = p.child.kill();
            }
        }
    });
}

fn spawn_stdio(cfg: &McpServerConfig) -> Result<StdioProc, String> {
    if cfg.command.trim().is_empty() {
        return Err("stdio transport 需要 command".into());
    }
    let mut cmd = Command::new(&cfg.command);
    cmd.args(&cfg.args)
        .envs(&cfg.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 MCP server 失败: {e}"))?;
    let stdin = child.stdin.take().ok_or("无法获取 stdin")?;
    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;

    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let pending_reader = pending.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if let Some(id) = v.get("id").and_then(|x| x.as_u64()) {
                if let Some(tx) = pending_reader.lock().remove(&id) {
                    let _ = tx.send(v);
                }
            }
            // Requests/notifications from server (sampling etc.) are ignored.
        }
    });

    Ok(StdioProc {
        child,
        stdin,
        pending,
        next_id: AtomicU64::new(1),
    })
}

fn initialize_params() -> Value {
    json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "aether", "version": env!("CARGO_PKG_VERSION")}
    })
}

async fn http_request(url: &str, method: &str, params: Value, id: u64) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(CALL_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;
    let body = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
    let res = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("MCP HTTP 请求失败: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("MCP HTTP {}", res.status()));
    }
    let ct = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if ct.contains("text/event-stream") {
        // Streamable HTTP: pick the first SSE data payload carrying our id
        for line in text.lines() {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
                if v.get("id").and_then(|x| x.as_u64()) == Some(id) {
                    return Ok(v);
                }
            }
        }
        Err("SSE 流中未找到响应".into())
    } else {
        serde_json::from_str(&text).map_err(|e| format!("响应 JSON 解析失败: {e}"))
    }
}

fn rpc_error(v: &Value) -> Option<String> {
    v.get("error").map(|e| {
        format!(
            "MCP 错误 {}: {}",
            e.get("code").and_then(|c| c.as_i64()).unwrap_or(0),
            e.get("message").and_then(|m| m.as_str()).unwrap_or("?")
        )
    })
}

fn parse_tools(v: &Value) -> Vec<McpToolInfo> {
    v.get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    Some(McpToolInfo {
                        name: t.get("name")?.as_str()?.to_string(),
                        description: t
                            .get("description")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string(),
                        input_schema: t
                            .get("inputSchema")
                            .cloned()
                            .unwrap_or_else(|| json!({"type": "object"})),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Flatten a tools/call result to display text, truncated to the byte cap.
fn result_text(v: &Value) -> String {
    let mut out = String::new();
    if let Some(content) = v
        .get("result")
        .and_then(|r| r.get("content"))
        .and_then(|c| c.as_array())
    {
        for item in content {
            match item.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                        out.push_str(t);
                        out.push('\n');
                    }
                }
                Some(other) => {
                    out.push_str(&format!("[{other} 内容已省略]\n"));
                }
                None => {}
            }
        }
    }
    if out.is_empty() {
        out = v
            .get("result")
            .map(|r| r.to_string())
            .unwrap_or_else(|| "（空结果）".into());
    }
    let is_err = v
        .get("result")
        .and_then(|r| r.get("isError"))
        .and_then(|e| e.as_bool())
        .unwrap_or(false);
    if is_err {
        out = format!("[工具返回错误]\n{out}");
    }
    if out.len() > MAX_RESULT_BYTES {
        let mut cut = MAX_RESULT_BYTES;
        while cut > 0 && !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        out.push_str("\n…[输出超限已截断]");
    }
    out
}

/// Connect (or reconnect) a server and return its tool list.
#[tauri::command]
pub async fn mcp_connect(config: McpServerConfig) -> Result<Vec<McpToolInfo>, String> {
    let id = config.id.clone();
    // Drop any previous instance first
    with_servers(|map| {
        if let Some(Server::Stdio(mut p)) = map.remove(&id) {
            let _ = p.child.kill();
        }
    });

    if config.transport == "http" {
        if config.url.trim().is_empty() {
            return Err("http transport 需要 url".into());
        }
        let init = http_request(&config.url, "initialize", initialize_params(), 1).await?;
        if let Some(e) = rpc_error(&init) {
            return Err(e);
        }
        let tools_v = http_request(&config.url, "tools/list", json!({}), 2).await?;
        if let Some(e) = rpc_error(&tools_v) {
            return Err(e);
        }
        let tools = parse_tools(&tools_v);
        with_servers(|map| {
            map.insert(id, Server::Http { url: config.url.clone() });
        });
        return Ok(tools);
    }

    // stdio: spawn + handshake off the async runtime
    let tools = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<McpToolInfo>, String> {
        let mut proc = spawn_stdio(&config)?;
        let init = proc.request(
            "initialize",
            initialize_params(),
            Duration::from_secs(INIT_TIMEOUT_SECS),
        )?;
        if let Some(e) = rpc_error(&init) {
            let _ = proc.child.kill();
            return Err(e);
        }
        proc.notify("notifications/initialized", json!({}));
        let tools_v = proc.request(
            "tools/list",
            json!({}),
            Duration::from_secs(INIT_TIMEOUT_SECS),
        )?;
        if let Some(e) = rpc_error(&tools_v) {
            let _ = proc.child.kill();
            return Err(e);
        }
        let tools = parse_tools(&tools_v);
        with_servers(|map| {
            map.insert(config.id.clone(), Server::Stdio(proc));
        });
        Ok(tools)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tools)
}

#[tauri::command]
pub async fn mcp_disconnect(server_id: String) -> Result<(), String> {
    with_servers(|map| {
        if let Some(Server::Stdio(mut p)) = map.remove(&server_id) {
            let _ = p.child.kill();
        }
    });
    Ok(())
}

#[tauri::command]
pub fn mcp_status(server_id: String) -> bool {
    with_servers(|map| match map.get_mut(&server_id) {
        Some(Server::Stdio(p)) => matches!(p.child.try_wait(), Ok(None)),
        Some(Server::Http { .. }) => true,
        None => false,
    })
}

#[tauri::command]
pub async fn mcp_call_tool(
    server_id: String,
    tool: String,
    args: Value,
) -> Result<String, String> {
    let http_url = with_servers(|map| match map.get(&server_id) {
        Some(Server::Http { url }) => Some(url.clone()),
        _ => None,
    });

    if let Some(url) = http_url {
        let v = http_request(
            &url,
            "tools/call",
            json!({"name": tool, "arguments": args}),
            99,
        )
        .await?;
        if let Some(e) = rpc_error(&v) {
            return Err(e);
        }
        return Ok(result_text(&v));
    }

    tauri::async_runtime::spawn_blocking(move || {
        with_servers(|map| match map.get_mut(&server_id) {
            Some(Server::Stdio(p)) => {
                if !matches!(p.child.try_wait(), Ok(None)) {
                    return Err("MCP server 进程已退出，请在设置中重连".to_string());
                }
                let v = p.request(
                    "tools/call",
                    json!({"name": tool, "arguments": args}),
                    Duration::from_secs(CALL_TIMEOUT_SECS),
                )?;
                if let Some(e) = rpc_error(&v) {
                    return Err(e);
                }
                Ok(result_text(&v))
            }
            _ => Err("MCP server 未连接".to_string()),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_tools_extracts_name_desc_schema() {
        let v = json!({"result": {"tools": [
            {"name": "read_file", "description": "Read", "inputSchema": {"type":"object","properties":{"path":{"type":"string"}}}},
            {"name": "no_desc"},
            {"description": "missing name ignored"}
        ]}});
        let tools = parse_tools(&v);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "read_file");
        assert_eq!(tools[1].description, "");
        assert_eq!(tools[1].input_schema["type"], "object");
    }

    #[test]
    fn result_text_flattens_and_marks_error() {
        let v = json!({"result": {"isError": true, "content": [
            {"type": "text", "text": "boom"},
            {"type": "image", "data": "…"}
        ]}});
        let t = result_text(&v);
        assert!(t.contains("[工具返回错误]"));
        assert!(t.contains("boom"));
        assert!(t.contains("[image 内容已省略]"));
    }

    #[test]
    fn result_text_truncates_at_cap() {
        let big = "x".repeat(MAX_RESULT_BYTES + 100);
        let v = json!({"result": {"content": [{"type": "text", "text": big}]}});
        let t = result_text(&v);
        assert!(t.len() <= MAX_RESULT_BYTES + 64);
        assert!(t.ends_with("…[输出超限已截断]"));
    }

    #[test]
    fn rpc_error_formats_code_message() {
        let v = json!({"error": {"code": -32601, "message": "Method not found"}});
        assert_eq!(
            rpc_error(&v).unwrap(),
            "MCP 错误 -32601: Method not found"
        );
        assert!(rpc_error(&json!({"result": {}})).is_none());
    }

    #[test]
    fn config_deserializes_camel_case_with_defaults() {
        let cfg: McpServerConfig = serde_json::from_str(
            r#"{"id":"a","name":"fs","transport":"stdio","command":"npx"}"#,
        )
        .unwrap();
        assert_eq!(cfg.command, "npx");
        assert!(cfg.args.is_empty());
        assert!(cfg.env.is_empty());
        assert_eq!(cfg.url, "");
    }
}
