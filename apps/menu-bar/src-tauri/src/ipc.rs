use serde::Serialize;

#[derive(Debug, Serialize, Default)]
pub struct ServiceStatusResponse {
    pub running: bool,
    pub directories: Vec<String>,
    #[serde(rename = "dryRun")]
    pub dry_run: bool,
}

/// Placeholder response representing the eventual bridge to the Node NamefixService
#[tauri::command]
pub async fn get_status() -> Result<ServiceStatusResponse, String> {
    // TODO: replace with shared service bridge (Phase 4)
    Ok(ServiceStatusResponse {
        running: false,
        directories: vec![],
        dry_run: true,
    })
}

#[derive(Debug, serde::Deserialize)]
pub struct ToggleRunningRequest {
    pub desired: Option<bool>,
}

#[tauri::command]
pub async fn toggle_running(_payload: ToggleRunningRequest) -> Result<(), String> {
    // TODO: proxy to service command when bridge is in place
    Err(String::from("watcher control not yet implemented"))
}

#[tauri::command]
pub async fn list_directories() -> Result<Vec<String>, String> {
    // TODO: return configured directories via NamefixService
    Ok(vec![])
}

#[derive(Debug, serde::Deserialize)]
pub struct LaunchOnLoginRequest {
    pub enabled: bool,
}

#[tauri::command]
pub async fn set_launch_on_login(_payload: LaunchOnLoginRequest) -> Result<(), String> {
    // TODO: forward to autostart plugin + service config once available
    Err(String::from("launch-on-login bridge pending"))
}
