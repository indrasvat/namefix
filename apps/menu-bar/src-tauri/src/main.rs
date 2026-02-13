#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod ipc;
mod tray;

use bridge::{init_bridge, BridgeState};
use tauri::{Manager, RunEvent, WindowEvent};
use ipc::{
    add_watch_dir,
    delete_profile,
    get_profile,
    get_profiles,
    get_status,
    list_directories,
    remove_watch_dir,
    reorder_profiles,
    set_dry_run,
    set_launch_on_login,
    set_profile,
    toggle_profile,
    toggle_running,
    undo,
};
use tray::{init_tray, register_status_listener, TrayState};

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
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Namefix Menu Bar starting...");

    tauri::Builder::default()
        .plugin(autostart_plugin())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            add_watch_dir,
            delete_profile,
            get_profile,
            get_profiles,
            get_status,
            list_directories,
            remove_watch_dir,
            reorder_profiles,
            set_dry_run,
            set_launch_on_login,
            set_profile,
            toggle_profile,
            toggle_running,
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
                    let tray_state = init_tray(&app_handle, &bridge)
                        .map_err(|err| -> Box<dyn std::error::Error> { Box::new(err) })?;
                    register_status_listener(&app_handle);
                    app.manage::<BridgeState>(bridge);
                    app.manage::<TrayState>(tray_state);
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                    Ok(())
                }
                Err(err) => Err(err.into()),
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Namefix menu bar")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                // Gracefully shut down the Node sidecar before the process exits
                if let Some(bridge) = app_handle.try_state::<BridgeState>() {
                    tauri::async_runtime::block_on(bridge.shutdown());
                }
            }
        });
}
