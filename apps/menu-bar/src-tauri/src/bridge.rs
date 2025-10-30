use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{atomic::{AtomicU64, Ordering}, Arc};
use tauri::async_runtime::{self, Mutex};
use tauri::{AppHandle, Manager};
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
            events: events_tx.clone(),
        });

        Self::spawn_reader(inner.clone(), stdout, events_tx.clone());
        Ok(Self(inner))
    }

    fn spawn_reader(inner: Arc<Inner>, stdout: tokio::process::ChildStdout, events_tx: broadcast::Sender<BridgeEvent>) {
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
        let id = self.0.counter.fetch_add(1, Ordering::SeqCst);
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
            let mut pending = self.0.pending.lock().await;
            if let Some(tx) = pending.remove(&id) {
                let _ = tx.send(Err(err.to_string()));
            }
            return Err(err.to_string());
        }

        match rx.await {
            Ok(Ok(value)) => serde_json::from_value::<T>(value).map_err(|err| err.to_string()),
            Ok(Err(err)) => Err(err),
            Err(_) => Err("bridge channel closed".to_string()),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<BridgeEvent> {
        self.0.events.subscribe()
    }
}

fn resolve_bridge_script(app_handle: &AppHandle) -> anyhow::Result<PathBuf> {
    if let Some(path) = app_handle.path_resolver().resolve_resource("service-bridge.mjs") {
        Ok(path)
    } else {
        let mut fallback = app_handle.path_resolver().app_dir().unwrap_or_else(|| PathBuf::from("."));
        fallback.pop(); // src-tauri
        fallback.push("resources");
        fallback.push("service-bridge.mjs");
        if fallback.exists() {
            Ok(fallback)
        } else {
            Err(anyhow::anyhow!("service bridge script not found"))
        }
    }
}

fn node_command() -> anyhow::Result<String> {
    std::env::var("NAMEFIX_NODE")
        .ok()
        .or_else(|| which::which("node").ok().map(|p| p.to_string_lossy().to_string()))
        .ok_or_else(|| anyhow::anyhow!("Node.js binary not found. Ensure Node is installed or set NAMEFIX_NODE."))
}

pub type BridgeState = NodeBridge;

pub async fn init_bridge(app_handle: &AppHandle) -> anyhow::Result<NodeBridge> {
    let bridge = NodeBridge::new(app_handle).await?;
    let mut rx = bridge.subscribe();
    let emitter_handle = app_handle.clone();
    async_runtime::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let event_name = format!("service://{}", event.name);
            let _ = emitter_handle.emit_all(&event_name, event.payload);
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
        None => Value::Null,
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

#[derive(Debug, Deserialize)]
pub struct UndoResult {
    pub ok: bool,
    pub reason: Option<String>,
}

pub async fn undo(bridge: &BridgeState) -> Result<UndoResult, String> {
    bridge.invoke::<UndoResult>("undo", Value::Null).await
}
*** End Patch
