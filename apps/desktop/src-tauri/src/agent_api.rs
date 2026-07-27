use futures_util::StreamExt;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use tauri::{AppHandle, Emitter};

/// One shared HTTP client so multi-round agent loops reuse pooled TCP/TLS
/// connections instead of paying a fresh handshake per round. Per-call timeouts
/// are set on each RequestBuilder; this default is only a backstop.
static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
  reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(180))
    .build()
    .expect("failed to build reqwest client")
});

/// Active chat streams that can be cancelled from the UI (Stop button).
static STREAM_CANCEL: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

fn cancel_map() -> parking_lot::MutexGuard<'static, Option<HashMap<String, Arc<AtomicBool>>>> {
  let mut g = STREAM_CANCEL.lock();
  if g.is_none() {
    *g = Some(HashMap::new());
  }
  g
}

pub fn cancel_stream(stream_id: &str) -> bool {
  let g = cancel_map();
  if let Some(map) = g.as_ref() {
    if let Some(flag) = map.get(stream_id) {
      flag.store(true, Ordering::SeqCst);
      return true;
    }
  }
  false
}

fn register_stream(stream_id: &str) -> Arc<AtomicBool> {
  let flag = Arc::new(AtomicBool::new(false));
  if let Some(map) = cancel_map().as_mut() {
    map.insert(stream_id.to_string(), flag.clone());
  }
  flag
}

fn unregister_stream(stream_id: &str) {
  if let Some(map) = cancel_map().as_mut() {
    map.remove(stream_id);
  }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsListRequest {
  pub endpoint: String,
  #[serde(alias = "api_key", alias = "apiKey")]
  pub api_key: Option<String>,
  pub provider: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ModelInfo {
  pub id: String,
  pub label: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
  pub endpoint: String,
  #[serde(alias = "api_key", alias = "apiKey")]
  pub api_key: Option<String>,
  #[allow(dead_code)]
  pub provider: Option<String>,
  pub model: String,
  pub messages: Vec<ChatMessage>,
  #[serde(alias = "stream_id", alias = "streamId")]
  pub stream_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatMessage {
  pub role: String,
  pub content: String,
}

/// Normalize OpenAI-compatible API base.
///
/// Users often paste gateway root like `https://s2a.err.ink/` while chat lives at
/// `…/v1/chat/completions`. Without `/v1`, POST `/chat/completions` may hit the
/// gateway status/options JSON (oauth flags, payment_enabled) → empty parse.
fn openai_base(endpoint: &str) -> String {
  let mut base = endpoint.trim().trim_end_matches('/').to_string();
  if base.is_empty() {
    return base;
  }
  // Already a full chat or models URL → strip to API root
  if let Some(i) = base.find("/chat/completions") {
    base = base[..i].trim_end_matches('/').to_string();
  } else if base.ends_with("/models") {
    base = base.trim_end_matches("/models").trim_end_matches('/').to_string();
  }
  // Common: host root only → assume OpenAI /v1 prefix (NewAPI / OneAPI / LiteLLM style)
  let lower = base.to_ascii_lowercase();
  let has_version = lower.ends_with("/v1")
    || lower.contains("/v1/")
    || lower.ends_with("/v1beta")
    || lower.contains("/openai")
    || lower.contains("/compatible");
  if !has_version {
    // Only auto-append when path is empty or just "/"-style host (no extra path segments
    // beyond scheme://host). If user set a custom path like /api, leave it.
    if let Some(scheme_end) = base.find("://") {
      let after = &base[scheme_end + 3..];
      // host only (no slash) or host with empty path
      if !after.contains('/') {
        base = format!("{base}/v1");
      }
    }
  }
  base
}

fn models_url(endpoint: &str) -> String {
  let base = openai_base(endpoint);
  if base.ends_with("/models") {
    base
  } else {
    format!("{base}/models")
  }
}

fn chat_url(endpoint: &str) -> String {
  let base = openai_base(endpoint);
  if base.ends_with("/chat/completions") {
    base
  } else {
    format!("{base}/chat/completions")
  }
}

/// Detect gateway status/options JSON mistaken for a chat completion body.
fn looks_like_gateway_status(v: &serde_json::Value) -> bool {
  v.get("payment_enabled").is_some()
    || v.get("github_oauth_enabled").is_some()
    || v.get("wechat_oauth_enabled").is_some()
    || v.get("wechat_oauth_open_enabled").is_some()
    || v.get("oidc_oauth_enabled").is_some()
    || (v.get("version").is_some() && v.get("start_time").is_some())
    || (v.get("system_name").is_some() && v.get("logo").is_some())
}

fn gateway_misroute_msg(endpoint: &str, used_url: &str) -> String {
  let base = openai_base(endpoint);
  format!(
    "收到的是网关状态/配置 JSON，不是模型对话结果。\n\
     当前请求: {used_url}\n\
     请把 API 端点改成 OpenAI 兼容 base，例如: {base}\n\
     （设置里填 host 时已自动补 /v1；若仍失败请手动写 https://你的域名/v1）"
  )
}

pub async fn list_models(req: ModelsListRequest) -> Result<Vec<ModelInfo>, String> {
  let is_anthropic = req.provider.as_deref() == Some("anthropic");
  let url = if is_anthropic {
    anthropic_models_url(&req.endpoint)
  } else {
    models_url(&req.endpoint)
  };
  let mut b = HTTP
    .get(&url)
    .timeout(std::time::Duration::from_secs(30))
    .header("Accept", "application/json")
    .header("User-Agent", "Aether/0.7");

  if is_anthropic {
    b = b.header("anthropic-version", "2023-06-01");
    if let Some(k) = req.api_key.as_ref().filter(|s| !s.is_empty()) {
      b = b.header("x-api-key", k.trim());
    }
  } else if let Some(k) = req.api_key.as_ref().filter(|s| !s.is_empty()) {
    b = b.bearer_auth(k.trim());
  }

  let res = b.send().await.map_err(|e| format!("网络错误: {e}"))?;
  let status = res.status();
  let body = res.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
  if !status.is_success() {
    let snippet: String = body.chars().take(200).collect();
    return Err(format!("HTTP {status}: {snippet}"));
  }

  let v: serde_json::Value =
    serde_json::from_str(&body).map_err(|e| format!("JSON 解析失败: {e}"))?;

  let arr = if let Some(a) = v.get("data").and_then(|x| x.as_array()) {
    a.clone()
  } else if let Some(a) = v.as_array() {
    a.clone()
  } else {
    vec![]
  };

  let mut out = Vec::new();
  for item in arr {
    let id = item
      .get("id")
      .and_then(|x| x.as_str())
      .or_else(|| item.as_str());
    let Some(id) = id.filter(|s| !s.is_empty()) else {
      continue;
    };
    let label = item
      .get("display_name")
      .and_then(|x| x.as_str())
      .or_else(|| item.get("name").and_then(|x| x.as_str()))
      .unwrap_or(id);
    out.push(ModelInfo {
      id: id.to_string(),
      label: label.to_string(),
    });
  }

  if out.is_empty() {
    return Err("响应中没有模型（data 为空）".into());
  }
  Ok(out)
}

#[derive(Clone, Serialize)]
struct ChatStreamEvent {
  id: String,
  #[serde(rename = "type")]
  kind: String,
  text: Option<String>,
  error: Option<String>,
}

pub async fn chat_stream(app: AppHandle, req: ChatRequest) -> Result<(), String> {
  let cancel = register_stream(&req.stream_id);
  let finish = |app: &AppHandle, id: &str, kind: &str, error: Option<String>| {
    let _ = app.emit(
      "agent://stream",
      ChatStreamEvent {
        id: id.to_string(),
        kind: kind.into(),
        text: None,
        error,
      },
    );
  };

  let result = chat_stream_inner(app.clone(), &req, cancel.clone()).await;
  unregister_stream(&req.stream_id);

  if cancel.load(Ordering::SeqCst) {
    finish(&app, &req.stream_id, "cancelled", None);
    return Ok(());
  }

  match result {
    Ok(()) => Ok(()),
    Err(e) => {
      // Avoid double error if inner already emitted
      if !e.starts_with("__emitted__") {
        finish(&app, &req.stream_id, "error", Some(e.clone()));
      }
      Err(e.replace("__emitted__", ""))
    }
  }
}

fn push_text_value(val: &serde_json::Value, out: &mut Vec<String>) {
  if let Some(s) = val.as_str() {
    if !s.is_empty() {
      out.push(s.to_string());
    }
    return;
  }
  if let Some(arr) = val.as_array() {
    for part in arr {
      if let Some(s) = part.as_str() {
        if !s.is_empty() {
          out.push(s.to_string());
        }
        continue;
      }
      if let Some(s) = part.get("text").and_then(|x| x.as_str()) {
        if !s.is_empty() {
          out.push(s.to_string());
        }
      } else if let Some(s) = part.get("content").and_then(|x| x.as_str()) {
        if !s.is_empty() {
          out.push(s.to_string());
        }
      }
    }
  }
}

fn extract_paths(v: &serde_json::Value, paths: &[&str]) -> Vec<String> {
  let mut out = Vec::new();
  for p in paths {
    if let Some(val) = v.pointer(p) {
      let before = out.len();
      push_text_value(val, &mut out);
      if out.len() == before {
        if let Some(arr) = val.as_array() {
          for item in arr {
            if let Some(s) = item.get("text").and_then(|x| x.as_str()) {
              if !s.is_empty() {
                out.push(s.to_string());
              }
            }
          }
        }
      }
    }
  }
  out
}

/// Final answer / visible content only (no reasoning channel).
fn extract_answer_pieces(v: &serde_json::Value) -> Vec<String> {
  extract_paths(
    v,
    &[
      "/choices/0/delta/content",
      "/choices/0/message/content",
      "/choices/0/text",
      "/choices/0/delta/text",
      "/output_text",
      "/response",
      "/content",
      "/text",
    ],
  )
}

/// Model "thinking" / reasoning channel (shown in collapsible UI, not main bubble).
fn extract_thinking_pieces(v: &serde_json::Value) -> Vec<String> {
  extract_paths(
    v,
    &[
      "/choices/0/delta/reasoning_content",
      "/choices/0/message/reasoning_content",
      "/choices/0/delta/reasoning",
      "/choices/0/message/reasoning",
      "/choices/0/delta/reasoning_details",
      "/choices/0/message/reasoning_details",
    ],
  )
}

/// Fallback: any text if answer channel empty (legacy proxies).
fn extract_text_pieces(v: &serde_json::Value) -> Vec<String> {
  let mut a = extract_answer_pieces(v);
  if a.is_empty() {
    a = extract_thinking_pieces(v);
  }
  a
}

fn emit_delta(app: &AppHandle, stream_id: &str, text: &str) {
  emit_stream_kind(app, stream_id, "delta", text);
}

fn emit_thinking(app: &AppHandle, stream_id: &str, text: &str) {
  emit_stream_kind(app, stream_id, "thinking", text);
}

fn emit_stream_kind(app: &AppHandle, stream_id: &str, kind: &str, text: &str) {
  if text.is_empty() {
    return;
  }
  let _ = app.emit(
    "agent://stream",
    ChatStreamEvent {
      id: stream_id.to_string(),
      kind: kind.into(),
      text: Some(text.to_string()),
      error: None,
    },
  );
}

fn emit_done(app: &AppHandle, stream_id: &str) {
  let _ = app.emit(
    "agent://stream",
    ChatStreamEvent {
      id: stream_id.to_string(),
      kind: "done".into(),
      text: None,
      error: None,
    },
  );
}

fn emit_error(app: &AppHandle, stream_id: &str, msg: &str) {
  let _ = app.emit(
    "agent://stream",
    ChatStreamEvent {
      id: stream_id.to_string(),
      kind: "error".into(),
      text: None,
      error: Some(msg.to_string()),
    },
  );
}

fn process_json_payload(
  app: &AppHandle,
  stream_id: &str,
  v: &serde_json::Value,
  endpoint_hint: Option<&str>,
  used_url: Option<&str>,
) -> Result<bool, String> {
  // true = got some text this payload
  if looks_like_gateway_status(v) {
    let msg = match (endpoint_hint, used_url) {
      (Some(ep), Some(u)) => gateway_misroute_msg(ep, u),
      _ => "收到网关状态 JSON，不是对话结果。请将 API 端点设为 https://域名/v1".into(),
    };
    emit_error(app, stream_id, &msg);
    return Err(format!("__emitted__{msg}"));
  }
  if let Some(err) = v.pointer("/error/message").and_then(|x| x.as_str()) {
    emit_error(app, stream_id, err);
    return Err(format!("__emitted__{err}"));
  }
  // Some proxies put error at top-level message
  if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
    emit_error(app, stream_id, err);
    return Err(format!("__emitted__{err}"));
  }

  let answer = extract_answer_pieces(v);
  let thinking = extract_thinking_pieces(v);
  let mut any = false;
  for p in &thinking {
    emit_thinking(app, stream_id, p);
    any = true;
  }
  for p in &answer {
    emit_delta(app, stream_id, p);
    any = true;
  }
  // Legacy: only reasoning streamed with no content field yet — still mark activity;
  // frontend keeps thinking separate; if never gets answer, fallback uses full extract.
  if !any {
    let legacy = extract_text_pieces(v);
    for p in legacy {
      emit_delta(app, stream_id, &p);
      any = true;
    }
  }
  Ok(any)
}

/// One line of SSE / NDJSON → process if it looks like JSON or data: JSON
fn process_stream_line(
  app: &AppHandle,
  stream_id: &str,
  line: &str,
  got_any: &mut bool,
  endpoint: &str,
  used_url: &str,
) -> Result<bool, String> {
  // returns Ok(true) if stream should end ([DONE])
  let trimmed = line.trim();
  if trimmed.is_empty() || trimmed.starts_with(':') {
    return Ok(false);
  }

  let data = if let Some(rest) = trimmed.strip_prefix("data:") {
    rest.trim()
  } else if trimmed.starts_with('{') {
    // NDJSON / raw JSON lines (some OpenAI-compatible proxies)
    trimmed
  } else {
    return Ok(false);
  };

  if data == "[DONE]" || data == "DONE" {
    return Ok(true);
  }

  if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
    if process_json_payload(app, stream_id, &v, Some(endpoint), Some(used_url))? {
      *got_any = true;
    }
    // finish_reason stop without content is fine; keep reading
  }
  Ok(false)
}

async fn chat_stream_inner(
  app: AppHandle,
  req: &ChatRequest,
  cancel: Arc<AtomicBool>,
) -> Result<(), String> {
  let url = chat_url(&req.endpoint);

  // Stream first (OpenAI-compatible)
  let body = serde_json::json!({
    "model": req.model,
    "messages": req.messages,
    "stream": true,
  });
  let mut b = HTTP
    .post(&url)
    .timeout(std::time::Duration::from_secs(120))
    .header("Content-Type", "application/json")
    .header("Accept", "text/event-stream, application/json")
    .header("User-Agent", "Aether/0.6")
    .json(&body);
  if let Some(k) = req.api_key.as_ref().filter(|s| !s.is_empty()) {
    b = b.bearer_auth(k.trim());
  }

  if cancel.load(Ordering::SeqCst) {
    return Ok(());
  }

  let res = b.send().await.map_err(|e| format!("网络错误: {e}"))?;
  if !res.status().is_success() {
    let status = res.status();
    let t = res.text().await.unwrap_or_default();
    let snippet: String = t.chars().take(400).collect();
    let msg = format!("HTTP {status}: {snippet}");
    emit_error(&app, &req.stream_id, &msg);
    return Err(format!("__emitted__{msg}"));
  }

  let content_type = res
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_ascii_lowercase();

  // Non-SSE: whole body is one JSON completion
  let is_plain_json =
    content_type.contains("application/json") && !content_type.contains("event-stream");

  if is_plain_json {
    let t = res.text().await.map_err(|e| e.to_string())?;
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
      let mut got = false;
      if process_json_payload(
        &app,
        &req.stream_id,
        &v,
        Some(&req.endpoint),
        Some(&url),
      )? {
        got = true;
      }
      if !got {
        let snip: String = t.chars().take(240).collect();
        if !snip.is_empty() {
          emit_error(
            &app,
            &req.stream_id,
            &format!("接口返回了 JSON 但没有可显示文本。片段: {snip}"),
          );
          return Err("__emitted__empty json".into());
        }
      }
      emit_done(&app, &req.stream_id);
      return Ok(());
    }
    // Unparseable JSON body — treat as empty
    let snip: String = t.chars().take(240).collect();
    emit_error(
      &app,
      &req.stream_id,
      &format!("响应不是合法 JSON。片段: {snip}"),
    );
    return Err("__emitted__bad json".into());
  }

  let mut stream = res.bytes_stream();
  let mut buffer = String::new();
  let mut got_any = false;
  let mut raw_tail = String::new();

  while let Some(item) = stream.next().await {
    if cancel.load(Ordering::SeqCst) {
      return Ok(());
    }
    let chunk = item.map_err(|e| e.to_string())?;
    let piece = String::from_utf8_lossy(&chunk);
    buffer.push_str(&piece);
    // keep a short raw tail for diagnostics
    raw_tail.push_str(&piece);
    if raw_tail.len() > 3200 {
      // Diagnostics-only tail: trim by bytes (walk up to a char boundary so we
      // never slice mid-codepoint) instead of counting/collecting chars twice.
      let mut cut = raw_tail.len() - 3200;
      while cut < raw_tail.len() && !raw_tail.is_char_boundary(cut) {
        cut += 1;
      }
      raw_tail.drain(..cut);
    }

    while let Some(pos) = buffer.find('\n') {
      if cancel.load(Ordering::SeqCst) {
        return Ok(());
      }
      let line = buffer[..pos].trim_end_matches('\r').to_string();
      // drain the consumed prefix in place — avoids re-allocating the whole
      // remaining buffer per line (was O(n²) on large multi-line chunks).
      buffer.drain(..=pos);
      if process_stream_line(
        &app,
        &req.stream_id,
        &line,
        &mut got_any,
        &req.endpoint,
        &url,
      )? {
        emit_done(&app, &req.stream_id);
        return Ok(());
      }
    }
  }

  // Flush last incomplete line
  if !buffer.trim().is_empty() {
    let _ = process_stream_line(
      &app,
      &req.stream_id,
      &buffer,
      &mut got_any,
      &req.endpoint,
      &url,
    )?;
  }

  // Stream ended with no parseable text → non-stream fallback (many proxies mishandle SSE)
  if !got_any && !cancel.load(Ordering::SeqCst) {
    if let Ok(Some(text)) = chat_non_stream(&HTTP, &url, req).await {
      if !text.is_empty() {
        emit_delta(&app, &req.stream_id, &text);
        got_any = true;
      }
    }
  }

  if !got_any {
    let snip: String = raw_tail.chars().take(280).collect();
    let looks_gateway = snip.contains("payment_enabled")
      || snip.contains("oauth_enabled")
      || snip.contains("wechat_oauth");
    let msg = if looks_gateway {
      gateway_misroute_msg(&req.endpoint, &url)
    } else if snip.trim().is_empty() {
      format!(
        "模型返回为空。当前请求 {url}。请确认端点为 OpenAI 兼容 base（如 https://域名/v1），模型 id 正确。"
      )
    } else {
      format!("未能解析模型输出。请求 {url}\n原始片段: {snip}")
    };
    emit_error(&app, &req.stream_id, &msg);
    return Err(format!("__emitted__{msg}"));
  }

  emit_done(&app, &req.stream_id);
  Ok(())
}

async fn chat_non_stream(
  client: &reqwest::Client,
  url: &str,
  req: &ChatRequest,
) -> Result<Option<String>, String> {
  let body = serde_json::json!({
    "model": req.model,
    "messages": req.messages,
    "stream": false,
  });
  let mut b = client
    .post(url)
    .timeout(std::time::Duration::from_secs(120))
    .header("Content-Type", "application/json")
    .header("Accept", "application/json")
    .header("User-Agent", "Aether/0.6")
    .json(&body);
  if let Some(k) = req.api_key.as_ref().filter(|s| !s.is_empty()) {
    b = b.bearer_auth(k.trim());
  }
  let res = b.send().await.map_err(|e| e.to_string())?;
  if !res.status().is_success() {
    return Ok(None);
  }
  let t = res.text().await.map_err(|e| e.to_string())?;
  let v: serde_json::Value = serde_json::from_str(&t).map_err(|e| e.to_string())?;
  if looks_like_gateway_status(&v) {
    return Ok(None);
  }
  let pieces = extract_text_pieces(&v);
  if pieces.is_empty() {
    return Ok(None);
  }
  Ok(Some(pieces.join("")))
}

// ── Tool-calling round (non-stream) for agent tool loop ─────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolChatRequest {
  pub endpoint: String,
  #[serde(alias = "api_key", alias = "apiKey")]
  pub api_key: Option<String>,
  #[allow(dead_code)]
  pub provider: Option<String>,
  pub model: String,
  /// Opaque OpenAI-style messages array (system/user/assistant/tool)
  pub messages: serde_json::Value,
  /// OpenAI tools array; empty / null = no tools
  pub tools: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallOut {
  pub id: String,
  pub name: String,
  pub arguments: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolChatResponse {
  pub content: Option<String>,
  pub tool_calls: Vec<ToolCallOut>,
  pub finish_reason: Option<String>,
  /// Full assistant message object (for multi-turn tool loops)
  pub assistant_message: serde_json::Value,
}

/// Read response body as lossy UTF-8 (avoids opaque "error decoding response body"
/// when gateways send odd encodings or partial frames).
async fn read_body_text(res: reqwest::Response) -> Result<(reqwest::StatusCode, String), String> {
  let status = res.status();
  let bytes = res
    .bytes()
    .await
    .map_err(|e| format!("读取响应失败: {e}"))?;
  let t = String::from_utf8_lossy(&bytes).into_owned();
  Ok((status, t))
}

pub async fn chat_with_tools(req: ToolChatRequest) -> Result<ToolChatResponse, String> {
  let url = chat_url(&req.endpoint);

  let mut body = serde_json::json!({
    "model": req.model,
    "messages": req.messages,
    "stream": false,
  });
  let use_tools = req
    .tools
    .as_ref()
    .and_then(|t| t.as_array())
    .map(|a| !a.is_empty())
    .unwrap_or(false);
  if use_tools {
    if let Some(tools) = &req.tools {
      body["tools"] = tools.clone();
      body["tool_choice"] = serde_json::json!("auto");
    }
  }

  let mut b = HTTP
    .post(&url)
    .timeout(std::time::Duration::from_secs(120))
    .header("Content-Type", "application/json")
    .header("Accept", "application/json")
    .header("User-Agent", "Aether/0.6")
    .json(&body);
  if let Some(k) = req.api_key.as_ref().filter(|s| !s.is_empty()) {
    b = b.bearer_auth(k.trim());
  }

  let res = b.send().await.map_err(|e| format!("网络错误: {e}"))?;
  let (status, t) = read_body_text(res).await?;
  if !status.is_success() {
    let snip: String = t.chars().take(400).collect();
    // Gateways often reject tools with 4xx — surface clearly for fallback
    if use_tools
      && (status.as_u16() == 400
        || status.as_u16() == 404
        || status.as_u16() == 422
        || snip.to_ascii_lowercase().contains("tool"))
    {
      return Err(format!("TOOLS_UNSUPPORTED HTTP {status}: {snip}"));
    }
    return Err(format!("HTTP {status}: {snip}"));
  }
  if t.trim().is_empty() {
    return Err("空响应体".into());
  }
  let v: serde_json::Value = serde_json::from_str(&t).map_err(|e| {
    let snip: String = t.chars().take(240).collect();
    format!("JSON 解析失败: {e} · 片段: {snip}")
  })?;
  if looks_like_gateway_status(&v) {
    return Err(gateway_misroute_msg(&req.endpoint, &url));
  }
  if let Some(err) = v.pointer("/error/message").and_then(|x| x.as_str()) {
    let low = err.to_ascii_lowercase();
    if use_tools && (low.contains("tool") || low.contains("function")) {
      return Err(format!("TOOLS_UNSUPPORTED: {err}"));
    }
    return Err(err.to_string());
  }

  let choice = v
    .pointer("/choices/0")
    .cloned()
    .unwrap_or(serde_json::Value::Null);
  let finish = choice
    .get("finish_reason")
    .and_then(|x| x.as_str())
    .map(|s| s.to_string());
  let message = choice
    .get("message")
    .cloned()
    .unwrap_or(serde_json::json!({"role":"assistant","content":""}));

  let content = message
    .get("content")
    .and_then(|c| {
      if c.is_string() {
        c.as_str().map(|s| s.to_string())
      } else if c.is_array() {
        // content parts
        let mut s = String::new();
        if let Some(arr) = c.as_array() {
          for p in arr {
            if let Some(t) = p.get("text").and_then(|x| x.as_str()) {
              s.push_str(t);
            }
          }
        }
        if s.is_empty() {
          None
        } else {
          Some(s)
        }
      } else {
        None
      }
    })
    .filter(|s| !s.is_empty());

  let mut tool_calls = Vec::new();
  if let Some(arr) = message.get("tool_calls").and_then(|x| x.as_array()) {
    for tc in arr {
      let id = tc
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
      let name = tc
        .pointer("/function/name")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
      let arguments = tc
        .pointer("/function/arguments")
        .and_then(|x| x.as_str())
        .unwrap_or("{}")
        .to_string();
      if !name.is_empty() {
        tool_calls.push(ToolCallOut {
          id: if id.is_empty() {
            format!("call_{}", tool_calls.len())
          } else {
            id
          },
          name,
          arguments,
        });
      }
    }
  }

  Ok(ToolChatResponse {
    content,
    tool_calls,
    finish_reason: finish,
    assistant_message: message,
  })
}

// ── 0.7 kernel: streaming tool-calling round (cancellable, multi-provider) ──
//
// One HTTP round: text/thinking stream to the UI via `agent://stream` events
// ("delta" / "thinking" — same kinds the panel already renders), while tool
// calls are accumulated and returned in the command result so the frontend
// loop decides what to execute next. Registered in STREAM_CANCEL, so the Stop
// button interrupts mid-flight requests (the old chat_with_tools could not).

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStreamRequest {
  pub endpoint: String,
  #[serde(alias = "api_key", alias = "apiKey")]
  pub api_key: Option<String>,
  pub provider: Option<String>,
  pub model: String,
  /// OpenAI-style messages array (system/user/assistant/tool) — uniform format
  /// for both providers; converted to Anthropic shape on demand.
  pub messages: serde_json::Value,
  pub tools: Option<serde_json::Value>,
  #[serde(alias = "stream_id", alias = "streamId")]
  pub stream_id: String,
  /// low | medium | high | max — mapped per provider (reasoning_effort / thinking budget)
  pub effort: Option<String>,
}

fn empty_assistant() -> serde_json::Value {
  serde_json::json!({"role": "assistant", "content": ""})
}

fn cancelled_response() -> ToolChatResponse {
  ToolChatResponse {
    content: None,
    tool_calls: Vec::new(),
    finish_reason: Some("cancelled".into()),
    assistant_message: empty_assistant(),
  }
}

pub async fn chat_stream_tools(
  app: AppHandle,
  req: ToolStreamRequest,
) -> Result<ToolChatResponse, String> {
  let cancel = register_stream(&req.stream_id);
  let is_anthropic = req.provider.as_deref() == Some("anthropic");
  let result = if is_anthropic {
    anthropic_stream_round(&app, &req, cancel.clone()).await
  } else {
    openai_stream_round(&app, &req, cancel.clone()).await
  };
  unregister_stream(&req.stream_id);

  if cancel.load(Ordering::SeqCst) {
    let _ = app.emit(
      "agent://stream",
      ChatStreamEvent {
        id: req.stream_id.clone(),
        kind: "cancelled".into(),
        text: None,
        error: None,
      },
    );
    return Ok(match result {
      Ok(mut r) => {
        r.finish_reason = Some("cancelled".into());
        r
      }
      Err(_) => cancelled_response(),
    });
  }
  result
}

/// Accumulates one streamed tool call (OpenAI delta fragments / Anthropic blocks).
#[derive(Default)]
struct ToolCallAcc {
  id: String,
  name: String,
  arguments: String,
}

fn build_assistant_message(
  content: &str,
  calls: &[ToolCallAcc],
) -> (Option<String>, Vec<ToolCallOut>, serde_json::Value) {
  let content_out = if content.is_empty() {
    None
  } else {
    Some(content.to_string())
  };
  let mut outs = Vec::new();
  let mut json_calls = Vec::new();
  for (i, c) in calls.iter().enumerate() {
    if c.name.is_empty() {
      continue;
    }
    let id = if c.id.is_empty() {
      format!("call_{i}")
    } else {
      c.id.clone()
    };
    let args = if c.arguments.trim().is_empty() {
      "{}".to_string()
    } else {
      c.arguments.clone()
    };
    json_calls.push(serde_json::json!({
      "id": id,
      "type": "function",
      "function": {"name": c.name, "arguments": args}
    }));
    outs.push(ToolCallOut {
      id,
      name: c.name.clone(),
      arguments: args,
    });
  }
  let mut msg = serde_json::json!({"role": "assistant"});
  msg["content"] = match &content_out {
    Some(s) => serde_json::Value::String(s.clone()),
    None => serde_json::Value::Null,
  };
  if !json_calls.is_empty() {
    msg["tool_calls"] = serde_json::Value::Array(json_calls);
  }
  (content_out, outs, msg)
}

// ── OpenAI-compatible streaming round ───────────────────────────────────

fn openai_ingest_delta(
  app: &AppHandle,
  stream_id: &str,
  v: &serde_json::Value,
  content: &mut String,
  calls: &mut Vec<ToolCallAcc>,
  finish: &mut Option<String>,
) {
  for p in extract_thinking_pieces(v) {
    emit_thinking(app, stream_id, &p);
  }
  if let Some(delta) = v.pointer("/choices/0/delta/content") {
    let mut pieces = Vec::new();
    push_text_value(delta, &mut pieces);
    for p in pieces {
      emit_delta(app, stream_id, &p);
      content.push_str(&p);
    }
  }
  if let Some(arr) = v.pointer("/choices/0/delta/tool_calls").and_then(|x| x.as_array()) {
    for tc in arr {
      let idx = tc.get("index").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
      while calls.len() <= idx {
        calls.push(ToolCallAcc::default());
      }
      let acc = &mut calls[idx];
      if let Some(id) = tc.get("id").and_then(|x| x.as_str()) {
        if !id.is_empty() {
          acc.id = id.to_string();
        }
      }
      if let Some(name) = tc.pointer("/function/name").and_then(|x| x.as_str()) {
        if !name.is_empty() {
          acc.name.push_str(name);
        }
      }
      if let Some(args) = tc.pointer("/function/arguments").and_then(|x| x.as_str()) {
        acc.arguments.push_str(args);
      }
    }
  }
  if let Some(f) = v.pointer("/choices/0/finish_reason").and_then(|x| x.as_str()) {
    if !f.is_empty() {
      *finish = Some(f.to_string());
    }
  }
}

async fn openai_stream_round(
  app: &AppHandle,
  req: &ToolStreamRequest,
  cancel: Arc<AtomicBool>,
) -> Result<ToolChatResponse, String> {
  let url = chat_url(&req.endpoint);

  let use_tools = req
    .tools
    .as_ref()
    .and_then(|t| t.as_array())
    .map(|a| !a.is_empty())
    .unwrap_or(false);

  let build_body = |with_effort: bool| {
    let mut body = serde_json::json!({
      "model": req.model,
      "messages": req.messages,
      "stream": true,
    });
    if use_tools {
      if let Some(tools) = &req.tools {
        body["tools"] = tools.clone();
        body["tool_choice"] = serde_json::json!("auto");
      }
    }
    if with_effort {
      if let Some(e) = req.effort.as_deref() {
        // "max" is not a standard OpenAI tier — send "high"
        let mapped = if e == "max" { "high" } else { e };
        if mapped == "low" || mapped == "medium" || mapped == "high" {
          body["reasoning_effort"] = serde_json::json!(mapped);
        }
      }
    }
    body
  };

  let send = |body: serde_json::Value| {
    let mut b = HTTP
      .post(&url)
      .timeout(std::time::Duration::from_secs(180))
      .header("Content-Type", "application/json")
      .header("Accept", "text/event-stream, application/json")
      .header("User-Agent", "Aether/0.7")
      .json(&body);
    if let Some(k) = req.api_key.as_ref().filter(|s| !s.is_empty()) {
      b = b.bearer_auth(k.trim());
    }
    b.send()
  };

  if cancel.load(Ordering::SeqCst) {
    return Ok(cancelled_response());
  }

  let mut res = send(build_body(true)).await.map_err(|e| format!("网络错误: {e}"))?;

  // Strict gateways may 400 on reasoning_effort — retry once without it
  if !res.status().is_success() && req.effort.is_some() {
    let status = res.status();
    let t = res.text().await.unwrap_or_default();
    if status.as_u16() == 400 && t.to_ascii_lowercase().contains("reasoning") {
      res = send(build_body(false)).await.map_err(|e| format!("网络错误: {e}"))?;
    } else {
      let snip: String = t.chars().take(400).collect();
      if use_tools && (status.as_u16() == 400 || status.as_u16() == 404 || status.as_u16() == 422) {
        return Err(format!("TOOLS_UNSUPPORTED HTTP {status}: {snip}"));
      }
      return Err(format!("HTTP {status}: {snip}"));
    }
  }

  if !res.status().is_success() {
    let status = res.status();
    let t = res.text().await.unwrap_or_default();
    let snip: String = t.chars().take(400).collect();
    if use_tools
      && (status.as_u16() == 400
        || status.as_u16() == 404
        || status.as_u16() == 422
        || snip.to_ascii_lowercase().contains("tool"))
    {
      return Err(format!("TOOLS_UNSUPPORTED HTTP {status}: {snip}"));
    }
    return Err(format!("HTTP {status}: {snip}"));
  }

  let content_type = res
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_ascii_lowercase();

  let mut content = String::new();
  let mut calls: Vec<ToolCallAcc> = Vec::new();
  let mut finish: Option<String> = None;

  // Some proxies ignore stream:true and return one JSON body
  if content_type.contains("application/json") && !content_type.contains("event-stream") {
    let t = res.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&t).map_err(|e| {
      let snip: String = t.chars().take(240).collect();
      format!("JSON 解析失败: {e} · 片段: {snip}")
    })?;
    if looks_like_gateway_status(&v) {
      return Err(gateway_misroute_msg(&req.endpoint, &url));
    }
    if let Some(err) = v.pointer("/error/message").and_then(|x| x.as_str()) {
      return Err(err.to_string());
    }
    // Whole-body completion: message shape, not delta shape
    let message = v
      .pointer("/choices/0/message")
      .cloned()
      .unwrap_or_else(empty_assistant);
    if let Some(s) = message.get("content").and_then(|x| x.as_str()) {
      emit_delta(app, &req.stream_id, s);
      content.push_str(s);
    }
    if let Some(arr) = message.get("tool_calls").and_then(|x| x.as_array()) {
      for tc in arr {
        calls.push(ToolCallAcc {
          id: tc.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
          name: tc
            .pointer("/function/name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
          arguments: tc
            .pointer("/function/arguments")
            .and_then(|x| x.as_str())
            .unwrap_or("{}")
            .to_string(),
        });
      }
    }
    finish = v
      .pointer("/choices/0/finish_reason")
      .and_then(|x| x.as_str())
      .map(|s| s.to_string());
  } else {
    let mut stream = res.bytes_stream();
    let mut buffer = String::new();
    'outer: while let Some(item) = stream.next().await {
      if cancel.load(Ordering::SeqCst) {
        break;
      }
      let chunk = item.map_err(|e| e.to_string())?;
      buffer.push_str(&String::from_utf8_lossy(&chunk));
      while let Some(pos) = buffer.find('\n') {
        let line = buffer[..pos].trim_end_matches('\r').to_string();
        buffer.drain(..=pos);
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(':') {
          continue;
        }
        let data = if let Some(rest) = trimmed.strip_prefix("data:") {
          rest.trim()
        } else if trimmed.starts_with('{') {
          trimmed
        } else {
          continue;
        };
        if data == "[DONE]" || data == "DONE" {
          break 'outer;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
          if looks_like_gateway_status(&v) {
            return Err(gateway_misroute_msg(&req.endpoint, &url));
          }
          if let Some(err) = v.pointer("/error/message").and_then(|x| x.as_str()) {
            return Err(err.to_string());
          }
          openai_ingest_delta(app, &req.stream_id, &v, &mut content, &mut calls, &mut finish);
        }
      }
    }
  }

  let (content_out, tool_calls, assistant_message) = build_assistant_message(&content, &calls);
  if finish.is_none() && !tool_calls.is_empty() {
    finish = Some("tool_calls".into());
  }
  Ok(ToolChatResponse {
    content: content_out,
    tool_calls,
    finish_reason: finish,
    assistant_message,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn openai_base_appends_v1_for_bare_host() {
    assert_eq!(openai_base("https://api.example.com/"), "https://api.example.com/v1");
    assert_eq!(openai_base("https://api.example.com/v1"), "https://api.example.com/v1");
    assert_eq!(openai_base("https://h.com/api"), "https://h.com/api");
  }

  #[test]
  fn anthropic_urls() {
    assert_eq!(
      anthropic_messages_url(""),
      "https://api.anthropic.com/v1/messages"
    );
    assert_eq!(
      anthropic_messages_url("https://gw.example.com/v1"),
      "https://gw.example.com/v1/messages"
    );
    assert_eq!(
      anthropic_models_url("https://gw.example.com"),
      "https://gw.example.com/v1/models"
    );
  }

  #[test]
  fn effort_budget_mapping() {
    assert_eq!(anthropic_effort_budget(Some("low")), (2048, None));
    assert_eq!(anthropic_effort_budget(None), (4096, None));
    assert_eq!(anthropic_effort_budget(Some("high")), (8192, Some(4096)));
    assert_eq!(anthropic_effort_budget(Some("max")), (16384, Some(8192)));
  }

  #[test]
  fn msgs_convert_system_tool_assistant() {
    let msgs = serde_json::json!([
      {"role": "system", "content": "S"},
      {"role": "user", "content": "hi"},
      {"role": "assistant", "content": "checking", "tool_calls": [
        {"id": "c1", "type": "function", "function": {"name": "read_pane", "arguments": "{\"serial\":1}"}}
      ]},
      {"role": "tool", "tool_call_id": "c1", "content": "output here"},
    ]);
    let (system, out) = openai_msgs_to_anthropic(&msgs);
    assert_eq!(system.as_deref(), Some("S"));
    assert_eq!(out.len(), 3);
    assert_eq!(out[0]["role"], "user");
    assert_eq!(out[1]["role"], "assistant");
    assert_eq!(out[1]["content"][0]["type"], "text");
    assert_eq!(out[1]["content"][1]["type"], "tool_use");
    assert_eq!(out[1]["content"][1]["input"]["serial"], 1);
    assert_eq!(out[2]["role"], "user");
    assert_eq!(out[2]["content"][0]["type"], "tool_result");
    assert_eq!(out[2]["content"][0]["tool_use_id"], "c1");
  }

  #[test]
  fn tools_convert_to_input_schema() {
    let tools = serde_json::json!([
      {"type": "function", "function": {"name": "run_command", "description": "d", "parameters": {"type": "object", "properties": {"command": {"type": "string"}}}}}
    ]);
    let out = openai_tools_to_anthropic(&tools);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0]["name"], "run_command");
    assert!(out[0]["input_schema"]["properties"]["command"].is_object());
  }

  #[test]
  fn assistant_message_rebuild() {
    let calls = vec![
      ToolCallAcc {
        id: "c9".into(),
        name: "list_panes".into(),
        arguments: "".into(),
      },
      ToolCallAcc::default(), // nameless fragment must be dropped
    ];
    let (content, outs, msg) = build_assistant_message("hello", &calls);
    assert_eq!(content.as_deref(), Some("hello"));
    assert_eq!(outs.len(), 1);
    assert_eq!(outs[0].arguments, "{}");
    assert_eq!(msg["tool_calls"][0]["function"]["name"], "list_panes");
    let (c2, o2, m2) = build_assistant_message("", &[]);
    assert!(c2.is_none());
    assert!(o2.is_empty());
    assert!(m2.get("tool_calls").is_none());
  }
}

// ── Anthropic native protocol ───────────────────────────────────────────

fn anthropic_base(endpoint: &str) -> String {
  let base = endpoint.trim().trim_end_matches('/').to_string();
  if base.is_empty() {
    return "https://api.anthropic.com".into();
  }
  base
}

fn anthropic_messages_url(endpoint: &str) -> String {
  let base = anthropic_base(endpoint);
  if base.ends_with("/v1/messages") {
    base
  } else if base.ends_with("/v1") {
    format!("{base}/messages")
  } else {
    format!("{base}/v1/messages")
  }
}

pub fn anthropic_models_url(endpoint: &str) -> String {
  let base = anthropic_base(endpoint);
  if base.ends_with("/v1") {
    format!("{base}/models")
  } else if base.ends_with("/models") {
    base
  } else {
    format!("{base}/v1/models")
  }
}

/// effort → (max_tokens, thinking budget). None = thinking disabled.
fn anthropic_effort_budget(effort: Option<&str>) -> (u32, Option<u32>) {
  match effort {
    Some("low") => (2048, None),
    Some("high") => (8192, Some(4096)),
    Some("max") => (16384, Some(8192)),
    _ => (4096, None),
  }
}

/// OpenAI-style messages → (system, anthropic messages).
fn openai_msgs_to_anthropic(
  messages: &serde_json::Value,
) -> (Option<String>, Vec<serde_json::Value>) {
  let mut system: Option<String> = None;
  let mut out: Vec<serde_json::Value> = Vec::new();
  let Some(arr) = messages.as_array() else {
    return (None, out);
  };
  for m in arr {
    let role = m.get("role").and_then(|x| x.as_str()).unwrap_or("");
    let text = m
      .get("content")
      .map(|c| {
        if let Some(s) = c.as_str() {
          s.to_string()
        } else if let Some(parts) = c.as_array() {
          let mut s = String::new();
          for p in parts {
            if let Some(t) = p.get("text").and_then(|x| x.as_str()) {
              s.push_str(t);
            }
          }
          s
        } else {
          String::new()
        }
      })
      .unwrap_or_default();
    match role {
      "system" => {
        let mut s = system.unwrap_or_default();
        if !s.is_empty() {
          s.push('\n');
        }
        s.push_str(&text);
        system = Some(s);
      }
      "tool" => {
        let tool_use_id = m
          .get("tool_call_id")
          .and_then(|x| x.as_str())
          .unwrap_or("")
          .to_string();
        out.push(serde_json::json!({
          "role": "user",
          "content": [{
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": text,
          }]
        }));
      }
      "assistant" => {
        let mut blocks: Vec<serde_json::Value> = Vec::new();
        if !text.is_empty() {
          blocks.push(serde_json::json!({"type": "text", "text": text}));
        }
        if let Some(calls) = m.get("tool_calls").and_then(|x| x.as_array()) {
          for tc in calls {
            let id = tc.get("id").and_then(|x| x.as_str()).unwrap_or("");
            let name = tc.pointer("/function/name").and_then(|x| x.as_str()).unwrap_or("");
            let args_raw = tc
              .pointer("/function/arguments")
              .and_then(|x| x.as_str())
              .unwrap_or("{}");
            let input: serde_json::Value =
              serde_json::from_str(args_raw).unwrap_or_else(|_| serde_json::json!({}));
            blocks.push(serde_json::json!({
              "type": "tool_use",
              "id": id,
              "name": name,
              "input": input,
            }));
          }
        }
        if blocks.is_empty() {
          continue;
        }
        out.push(serde_json::json!({"role": "assistant", "content": blocks}));
      }
      "user" => {
        if let Some(parts) = m.get("content").and_then(|c| c.as_array()) {
          let mut blocks = Vec::new();
          for part in parts {
            if let Some(value) = part.get("text").and_then(|v| v.as_str()) {
              if !value.is_empty() {
                blocks.push(serde_json::json!({"type": "text", "text": value}));
              }
            }
            let image_url = part
              .get("image_url")
              .and_then(|value| value.get("url").or(Some(value)))
              .and_then(|value| value.as_str());
            if let Some(url) = image_url {
              if let Some((mime, data)) = url.strip_prefix("data:").and_then(|v| v.split_once(";base64,")) {
                if matches!(mime, "image/png" | "image/jpeg" | "image/webp" | "image/gif") && !data.is_empty() {
                  blocks.push(serde_json::json!({
                    "type": "image",
                    "source": {"type": "base64", "media_type": mime, "data": data},
                  }));
                }
              }
            }
          }
          if !blocks.is_empty() {
            out.push(serde_json::json!({"role": "user", "content": blocks}));
          }
        } else if !text.is_empty() {
          out.push(serde_json::json!({"role": "user", "content": text}));
        }
      }
      _ => {}
    }
  }
  (system, out)
}

/// OpenAI tools array → Anthropic tools array.
fn openai_tools_to_anthropic(tools: &serde_json::Value) -> Vec<serde_json::Value> {
  let mut out = Vec::new();
  let Some(arr) = tools.as_array() else {
    return out;
  };
  for t in arr {
    let f = t.get("function").unwrap_or(t);
    let name = f.get("name").and_then(|x| x.as_str()).unwrap_or("");
    if name.is_empty() {
      continue;
    }
    let desc = f.get("description").and_then(|x| x.as_str()).unwrap_or("");
    let schema = f
      .get("parameters")
      .cloned()
      .unwrap_or_else(|| serde_json::json!({"type": "object", "properties": {}}));
    out.push(serde_json::json!({
      "name": name,
      "description": desc,
      "input_schema": schema,
    }));
  }
  out
}

async fn anthropic_stream_round(
  app: &AppHandle,
  req: &ToolStreamRequest,
  cancel: Arc<AtomicBool>,
) -> Result<ToolChatResponse, String> {
  let url = anthropic_messages_url(&req.endpoint);

  let (system, messages) = openai_msgs_to_anthropic(&req.messages);
  let (max_tokens, thinking_budget) = anthropic_effort_budget(req.effort.as_deref());

  let mut body = serde_json::json!({
    "model": req.model,
    "messages": messages,
    "max_tokens": max_tokens,
    "stream": true,
  });
  if let Some(s) = system.filter(|s| !s.is_empty()) {
    body["system"] = serde_json::json!(s);
  }
  if let Some(tools) = req.tools.as_ref() {
    let at = openai_tools_to_anthropic(tools);
    if !at.is_empty() {
      body["tools"] = serde_json::Value::Array(at);
    }
  }
  if let Some(budget) = thinking_budget {
    body["thinking"] = serde_json::json!({"type": "enabled", "budget_tokens": budget});
  }

  let mut b = HTTP
    .post(&url)
    .timeout(std::time::Duration::from_secs(180))
    .header("Content-Type", "application/json")
    .header("Accept", "text/event-stream")
    .header("anthropic-version", "2023-06-01")
    .header("User-Agent", "Aether/0.7")
    .json(&body);
  if let Some(k) = req.api_key.as_ref().filter(|s| !s.is_empty()) {
    b = b.header("x-api-key", k.trim());
  }

  if cancel.load(Ordering::SeqCst) {
    return Ok(cancelled_response());
  }

  let res = b.send().await.map_err(|e| format!("网络错误: {e}"))?;
  if !res.status().is_success() {
    let status = res.status();
    let t = res.text().await.unwrap_or_default();
    let snip: String = t.chars().take(400).collect();
    return Err(format!("HTTP {status}: {snip}"));
  }

  let mut content = String::new();
  let mut calls: Vec<ToolCallAcc> = Vec::new();
  let mut finish: Option<String> = None;
  // Anthropic block index → position in `calls` (text/thinking blocks are not tool calls)
  let mut block_to_call: HashMap<u64, usize> = HashMap::new();

  let mut stream = res.bytes_stream();
  let mut buffer = String::new();
  'outer: while let Some(item) = stream.next().await {
    if cancel.load(Ordering::SeqCst) {
      break;
    }
    let chunk = item.map_err(|e| e.to_string())?;
    buffer.push_str(&String::from_utf8_lossy(&chunk));
    while let Some(pos) = buffer.find('\n') {
      let line = buffer[..pos].trim_end_matches('\r').to_string();
      buffer.drain(..=pos);
      let trimmed = line.trim();
      let Some(data) = trimmed.strip_prefix("data:").map(|s| s.trim()) else {
        continue;
      };
      let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
        continue;
      };
      match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
        "content_block_start" => {
          let idx = v.get("index").and_then(|x| x.as_u64()).unwrap_or(0);
          if v.pointer("/content_block/type").and_then(|x| x.as_str()) == Some("tool_use") {
            let id = v
              .pointer("/content_block/id")
              .and_then(|x| x.as_str())
              .unwrap_or("")
              .to_string();
            let name = v
              .pointer("/content_block/name")
              .and_then(|x| x.as_str())
              .unwrap_or("")
              .to_string();
            calls.push(ToolCallAcc {
              id,
              name,
              arguments: String::new(),
            });
            block_to_call.insert(idx, calls.len() - 1);
          }
        }
        "content_block_delta" => {
          let idx = v.get("index").and_then(|x| x.as_u64()).unwrap_or(0);
          match v.pointer("/delta/type").and_then(|x| x.as_str()).unwrap_or("") {
            "text_delta" => {
              if let Some(t) = v.pointer("/delta/text").and_then(|x| x.as_str()) {
                emit_delta(app, &req.stream_id, t);
                content.push_str(t);
              }
            }
            "thinking_delta" => {
              if let Some(t) = v.pointer("/delta/thinking").and_then(|x| x.as_str()) {
                emit_thinking(app, &req.stream_id, t);
              }
            }
            "input_json_delta" => {
              if let Some(&ci) = block_to_call.get(&idx) {
                if let Some(t) = v.pointer("/delta/partial_json").and_then(|x| x.as_str()) {
                  calls[ci].arguments.push_str(t);
                }
              }
            }
            _ => {}
          }
        }
        "message_delta" => {
          if let Some(sr) = v.pointer("/delta/stop_reason").and_then(|x| x.as_str()) {
            finish = Some(match sr {
              "tool_use" => "tool_calls".to_string(),
              "end_turn" => "stop".to_string(),
              "max_tokens" => "length".to_string(),
              other => other.to_string(),
            });
          }
        }
        "message_stop" => break 'outer,
        "error" => {
          let msg = v
            .pointer("/error/message")
            .and_then(|x| x.as_str())
            .unwrap_or("Anthropic 流错误")
            .to_string();
          return Err(msg);
        }
        _ => {}
      }
    }
  }

  let (content_out, tool_calls, assistant_message) = build_assistant_message(&content, &calls);
  if finish.is_none() && !tool_calls.is_empty() {
    finish = Some("tool_calls".into());
  }
  Ok(ToolChatResponse {
    content: content_out,
    tool_calls,
    finish_reason: finish,
    assistant_message,
  })
}
