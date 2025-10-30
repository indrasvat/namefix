#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod ipc;

use bridge::{init_bridge, BridgeState};
use tauri::Manager;
use ipc::{
    get_status,
    list_directories,
    set_dry_run,
    set_launch_on_login,
    toggle_running,
    undo,
};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;

fn autostart_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    #[cfg(target_os = "macos")]
    {
        tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None)
    }

    #[cfg(not(target_os = "macos"))]
    {
        tauri_plugin_autostart::init()
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(autostart_plugin())
        .invoke_handler(tauri::generate_handler![
            get_status,
            toggle_running,
            list_directories,
            set_launch_on_login,
            set_dry_run,
            undo
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(ActivationPolicy::Accessory);
            }
            let app_handle = app.handle().clone();
            match tauri::async_runtime::block_on(async { init_bridge(&app_handle).await }) {
                Ok(bridge) => {
                    app.manage::<BridgeState>(bridge);
                    Ok(())
                }
                Err(err) => Err(Box::new(err) as Box<dyn std::error::Error>),
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Namefix menu bar");
}
