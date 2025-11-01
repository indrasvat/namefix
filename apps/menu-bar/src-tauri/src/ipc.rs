use crate::bridge::{self, BridgeState, ServiceStatus};
use anyhow::anyhow;

fn map_bridge_err<T>(result: Result<T, String>) -> tauri::Result<T> {
    result.map_err(|err| tauri::Error::Anyhow(anyhow!(err)))
}

#[tauri::command]
pub async fn get_status(state: tauri::State<'_, BridgeState>) -> tauri::Result<ServiceStatus> {
    map_bridge_err(bridge::get_status(&state).await)
}

#[tauri::command]
pub async fn toggle_running(
    state: tauri::State<'_, BridgeState>,
    desired: Option<bool>,
) -> tauri::Result<ServiceStatus> {
    map_bridge_err(bridge::toggle_running(&state, desired).await)
}

#[tauri::command]
pub async fn list_directories(state: tauri::State<'_, BridgeState>) -> tauri::Result<Vec<String>> {
    map_bridge_err(bridge::list_directories(&state).await)
}

#[tauri::command]
pub async fn set_launch_on_login(
    state: tauri::State<'_, BridgeState>,
    enabled: bool,
) -> tauri::Result<bool> {
    map_bridge_err(bridge::set_launch_on_login(&state, enabled).await)
}

#[tauri::command]
pub async fn set_dry_run(
    state: tauri::State<'_, BridgeState>,
    enabled: bool,
) -> tauri::Result<ServiceStatus> {
    map_bridge_err(bridge::set_dry_run(&state, enabled).await)
}

#[tauri::command]
pub async fn undo(state: tauri::State<'_, BridgeState>) -> tauri::Result<bridge::UndoResult> {
    map_bridge_err(bridge::undo(&state).await)
}

#[tauri::command]
pub async fn add_watch_dir(
    state: tauri::State<'_, BridgeState>,
    directory: String,
) -> tauri::Result<Vec<String>> {
    map_bridge_err(bridge::add_watch_dir(&state, directory).await)
}

#[tauri::command]
pub async fn remove_watch_dir(
    state: tauri::State<'_, BridgeState>,
    directory: String,
) -> tauri::Result<Vec<String>> {
    map_bridge_err(bridge::remove_watch_dir(&state, directory).await)
}
