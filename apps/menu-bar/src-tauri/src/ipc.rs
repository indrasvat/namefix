use crate::bridge::{self, BridgeState, ServiceStatus};
use serde::Deserialize;

#[tauri::command]
pub async fn get_status(state: tauri::State<'_, BridgeState>) -> Result<ServiceStatus, String> {
    bridge::get_status(&state).await
}

#[derive(Debug, Deserialize)]
pub struct ToggleRunningRequest {
    pub desired: Option<bool>,
}

#[tauri::command]
pub async fn toggle_running(
    state: tauri::State<'_, BridgeState>,
    payload: ToggleRunningRequest,
) -> Result<ServiceStatus, String> {
    bridge::toggle_running(&state, payload.desired).await
}

#[tauri::command]
pub async fn list_directories(state: tauri::State<'_, BridgeState>) -> Result<Vec<String>, String> {
    bridge::list_directories(&state).await
}

#[derive(Debug, Deserialize)]
pub struct LaunchOnLoginRequest {
    pub enabled: bool,
}

#[tauri::command]
pub async fn set_launch_on_login(
    state: tauri::State<'_, BridgeState>,
    payload: LaunchOnLoginRequest,
) -> Result<bool, String> {
    bridge::set_launch_on_login(&state, payload.enabled).await
}

#[derive(Debug, Deserialize)]
pub struct SetDryRunRequest {
    pub enabled: bool,
}

#[tauri::command]
pub async fn set_dry_run(
    state: tauri::State<'_, BridgeState>,
    payload: SetDryRunRequest,
) -> Result<ServiceStatus, String> {
    bridge::set_dry_run(&state, payload.enabled).await
}

#[tauri::command]
pub async fn undo(state: tauri::State<'_, BridgeState>) -> Result<bridge::UndoResult, String> {
    bridge::undo(&state).await
}

#[derive(Debug, Deserialize)]
pub struct DirectoryRequest {
    pub directory: String,
}

#[tauri::command]
pub async fn add_watch_dir(
    state: tauri::State<'_, BridgeState>,
    payload: DirectoryRequest,
) -> Result<Vec<String>, String> {
    bridge::add_watch_dir(&state, payload.directory).await
}

#[tauri::command]
pub async fn remove_watch_dir(
    state: tauri::State<'_, BridgeState>,
    payload: DirectoryRequest,
) -> Result<Vec<String>, String> {
    bridge::remove_watch_dir(&state, payload.directory).await
}
