use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc};
use tauri::async_runtime::{self, Mutex};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, oneshot};

#[derive(Debug, Clone)]
pub struct BridgeEvent {
    pub name: String,
    pub payload: Value,
}

struct Inner {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    counter: AtomicU64,
    dead: AtomicBool,
    events: broadcast::Sender<BridgeEvent>,
}

#[derive(Clone)]
pub struct NodeBridge(Arc<Inner>);

impl NodeBridge {
    pub async fn new(app_handle: &AppHandle) -> anyhow::Result<Self> {
        let script_path = resolve_bridge_script(app_handle)?;
        let mut command = Command::new(node_command()?);
        command
            .arg(&script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        let mut child = command.spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("bridge stdin unavailable"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("bridge stdout unavailable"))?;

        let (events_tx, _events_rx) = broadcast::channel(32);
        let inner = Arc::new(Inner {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(1),
            dead: AtomicBool::new(false),
            events: events_tx.clone(),
        });

        Self::spawn_reader(inner.clone(), stdout, events_tx.clone(), app_handle.clone());
        Ok(Self(inner))
    }

    fn spawn_reader(
        inner: Arc<Inner>,
        stdout: tokio::process::ChildStdout,
        events_tx: broadcast::Sender<BridgeEvent>,
        app_handle: AppHandle,
    ) {
        async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(&line) {
                    Ok(message) => {
                        if let Some(event) = message.get("event").and_then(|v| v.as_str()) {
                            let payload = message.get("payload").cloned().unwrap_or(Value::Null);
                            match event {
                                "file" => {
                                    let kind = payload.get("kind").and_then(|v| v.as_str()).unwrap_or("?");
                                    let file = payload.get("file").and_then(|v| v.as_str()).unwrap_or("?");
                                    let target = payload.get("target").and_then(|v| v.as_str());
                                    if let Some(t) = target {
                                        log::info!("File event: {} {} → {}", kind, file, t);
                                    } else {
                                        log::info!("File event: {} {}", kind, file);
                                    }
                                }
                                "toast" => {
                                    let level = payload.get("level").and_then(|v| v.as_str()).unwrap_or("info");
                                    let msg = payload.get("message").and_then(|v| v.as_str()).unwrap_or("?");
                                    log::info!("Toast [{}]: {}", level, msg);
                                }
                                "status" => {
                                    let running = payload.get("running").and_then(|v| v.as_bool()).unwrap_or(false);
                                    let dirs = payload.get("directories").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                                    log::info!("Status: running={}, dirs={}", running, dirs);
                                }
                                _ => {
                                    log::debug!("Bridge event: {}", event);
                                }
                            }
                            let _ = events_tx.send(BridgeEvent {
                                name: event.to_string(),
                                payload,
                            });
                        } else if let Some(id) = message.get("id").and_then(|v| v.as_u64()) {
                            let result = if let Some(error) = message.get("error") {
                                Err(error.as_str().unwrap_or("unknown bridge error").to_string())
                            } else {
                                Ok(message.get("result").cloned().unwrap_or(Value::Null))
                            };

                            let tx_opt = {
                                let mut pending = inner.pending.lock().await;
                                pending.remove(&id)
                            };
                            if let Some(tx) = tx_opt {
                                let _ = tx.send(result);
                            }
                        }
                    }
                    Err(err) => {
                        let mut pending = inner.pending.lock().await;
                        let items: Vec<_> = pending.drain().collect();
                        drop(pending);
                        for (_, tx) in items {
                            let _ = tx.send(Err(format!("bridge parse error: {err}")));
                        }
                    }
                }
            }

            // Reader loop exited - sidecar crashed or EOF
            log::error!("Bridge sidecar stdout reader exited unexpectedly");
            inner.dead.store(true, Ordering::SeqCst);

            // Notify all pending requests
            {
                let mut pending = inner.pending.lock().await;
                let items: Vec<_> = pending.drain().collect();
                drop(pending);
                for (_, tx) in items {
                    let _ = tx.send(Err("Bridge sidecar disconnected".to_string()));
                }
            }

            // Emit error toast to user
            let _ = app_handle.emit(
                "service://toast",
                serde_json::json!({
                    "message": "Background service disconnected. Please restart the app.",
                    "level": "error"
                }),
            );
        });
    }

    async fn write_request(&self, payload: &Value) -> anyhow::Result<()> {
        let mut stdin = self.0.stdin.lock().await;
        let serialized = serde_json::to_vec(payload)?;
        stdin.write_all(&serialized).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    pub async fn invoke<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<T, String> {
        if self.0.dead.load(Ordering::SeqCst) {
            return Err("Background service disconnected. Please restart the app.".to_string());
        }
        let id = self.0.counter.fetch_add(1, Ordering::SeqCst);
        log::debug!("Bridge invoke: id={}, method={}", id, method);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.0.pending.lock().await;
            pending.insert(id, tx);
        }
        let payload = json!({
            "id": id,
            "method": method,
            "params": params,
        });
        if let Err(err) = self.write_request(&payload).await {
            log::error!("Bridge write_request failed: {}", err);
            self.0.dead.store(true, Ordering::SeqCst);
            let mut pending = self.0.pending.lock().await;
            if let Some(tx) = pending.remove(&id) {
                let _ = tx.send(Err("Background service disconnected. Please restart the app.".to_string()));
            }
            return Err("Background service disconnected. Please restart the app.".to_string());
        }
        log::debug!("Bridge request sent, waiting for response...");

        match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
            Ok(Ok(Ok(value))) => {
                log::debug!("Bridge response received: {:?}", value);
                serde_json::from_value::<T>(value).map_err(|err| err.to_string())
            }
            Ok(Ok(Err(err))) => {
                log::error!("Bridge response error: {}", err);
                Err(err)
            }
            Ok(Err(_)) => {
                log::error!("Bridge channel closed");
                Err("bridge channel closed".to_string())
            }
            Err(_) => {
                log::error!("Bridge request timed out: method={}", method);
                let mut pending = self.0.pending.lock().await;
                pending.remove(&id);
                Err("Bridge request timed out".to_string())
            }
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<BridgeEvent> {
        self.0.events.subscribe()
    }

    /// Gracefully shut down the Node sidecar. Sends "shutdown" command and waits
    /// briefly for the child process to exit before forcibly killing it.
    pub async fn shutdown(&self) {
        // Try graceful shutdown via the protocol
        let _ = self.invoke::<Value>("shutdown", Value::Null).await;

        // Give the sidecar a moment to flush and exit
        std::thread::sleep(std::time::Duration::from_millis(200));

        // Force-kill if still alive
        let mut child = self.0.child.lock().await;
        let _ = child.kill().await;
    }
}

fn resolve_bridge_script(app_handle: &AppHandle) -> anyhow::Result<PathBuf> {
    let resource_candidates = [
        "service-bridge.mjs",
        "resources/service-bridge.mjs",
    ];

    for candidate in resource_candidates {
        if let Ok(path) = app_handle.path().resolve(candidate, BaseDirectory::Resource) {
            if path.exists() {
                return Ok(path);
            }
        }
    }

    let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/service-bridge.mjs");
    if fallback.exists() {
        Ok(fallback)
    } else {
        Err(anyhow::anyhow!("service bridge script not found"))
    }
}

fn node_command() -> anyhow::Result<String> {
    if let Ok(path) = std::env::var("NAMEFIX_NODE") {
        return Ok(path);
    }

    if let Ok(path) = which::which("node") {
        return Ok(path.to_string_lossy().to_string());
    }

    // Fallback: check common locations that might not be in the GUI app's PATH
    let mut candidates = vec![
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/bin/node"),
    ];

    // Check user-specific paths (e.g. Volta)
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(home).join(".volta/bin/node"));
    }

    for path in candidates {
        if path.exists() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    Err(anyhow::anyhow!("Node.js binary not found. Ensure Node is installed or set NAMEFIX_NODE."))
}

pub type BridgeState = NodeBridge;

pub async fn init_bridge(app_handle: &AppHandle) -> anyhow::Result<NodeBridge> {
    let bridge = NodeBridge::new(app_handle).await?;
    let mut rx = bridge.subscribe();
    let emitter_handle = app_handle.clone();
    async_runtime::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let event_name = format!("service://{}", event.name);
            let _ = emitter_handle.emit(&event_name, event.payload);
        }
    });
    Ok(bridge)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
  pub running: bool,
  pub directories: Vec<String>,
  #[serde(rename = "dryRun")]
  pub dry_run: bool,
  #[serde(rename = "launchOnLogin")]
  pub launch_on_login: bool,
}

pub async fn get_status(bridge: &BridgeState) -> Result<ServiceStatus, String> {
    bridge.invoke::<ServiceStatus>("getStatus", Value::Null).await
}

pub async fn toggle_running(bridge: &BridgeState, desired: Option<bool>) -> Result<ServiceStatus, String> {
    let params = match desired {
        Some(flag) => json!({ "desired": flag }),
        None => json!({}),  // Empty object, not null: JS default params only apply for undefined, and JSON-RPC treats null as defined
    };
    bridge.invoke::<ServiceStatus>("toggleRunning", params).await
}

pub async fn list_directories(bridge: &BridgeState) -> Result<Vec<String>, String> {
    bridge.invoke::<Vec<String>>("listDirectories", Value::Null).await
}

pub async fn set_launch_on_login(bridge: &BridgeState, enabled: bool) -> Result<bool, String> {
    let params = json!({ "enabled": enabled });
    bridge.invoke::<bool>("setLaunchOnLogin", params).await
}

pub async fn set_dry_run(bridge: &BridgeState, enabled: bool) -> Result<ServiceStatus, String> {
    let params = json!({ "enabled": enabled });
    bridge.invoke::<ServiceStatus>("setDryRun", params).await
}

pub async fn add_watch_dir(bridge: &BridgeState, directory: String) -> Result<Vec<String>, String> {
    let params = json!({ "directory": directory });
    bridge.invoke::<Vec<String>>("addWatchDir", params).await
}

pub async fn remove_watch_dir(bridge: &BridgeState, directory: String) -> Result<Vec<String>, String> {
    let params = json!({ "directory": directory });
    bridge.invoke::<Vec<String>>("removeWatchDir", params).await
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UndoResult {
    pub ok: bool,
    pub reason: Option<String>,
}

pub async fn undo(bridge: &BridgeState) -> Result<UndoResult, String> {
    bridge.invoke::<UndoResult>("undo", Value::Null).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub pattern: String,
    #[serde(rename = "isRegex")]
    pub is_regex: Option<bool>,
    pub template: String,
    pub prefix: String,
    pub priority: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
}

pub async fn get_profiles(bridge: &BridgeState) -> Result<Vec<Profile>, String> {
    bridge.invoke::<Vec<Profile>>("getProfiles", Value::Null).await
}

pub async fn get_profile(bridge: &BridgeState, id: String) -> Result<Option<Profile>, String> {
    let params = json!({ "id": id });
    bridge.invoke::<Option<Profile>>("getProfile", params).await
}

pub async fn set_profile(bridge: &BridgeState, profile: Profile) -> Result<Vec<Profile>, String> {
    let params = json!({ "profile": profile });
    bridge.invoke::<Vec<Profile>>("setProfile", params).await
}

pub async fn delete_profile(bridge: &BridgeState, id: String) -> Result<Vec<Profile>, String> {
    let params = json!({ "id": id });
    bridge.invoke::<Vec<Profile>>("deleteProfile", params).await
}

pub async fn toggle_profile(bridge: &BridgeState, id: String, enabled: Option<bool>) -> Result<Vec<Profile>, String> {
    let params = json!({ "id": id, "enabled": enabled });
    bridge.invoke::<Vec<Profile>>("toggleProfile", params).await
}

pub async fn reorder_profiles(bridge: &BridgeState, ordered_ids: Vec<String>) -> Result<Vec<Profile>, String> {
    let params = json!({ "orderedIds": ordered_ids });
    bridge.invoke::<Vec<Profile>>("reorderProfiles", params).await
}
