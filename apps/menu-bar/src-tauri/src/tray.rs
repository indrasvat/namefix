use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::{
    async_runtime,
    image::Image,
    menu::{CheckMenuItem, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Listener, Manager, Wry,
};

use crate::bridge::{self, BridgeState, ServiceStatus};

const MENU_VERSION: &str = "version-label";
const MENU_STATUS: &str = "status-label";
const MENU_TOGGLE_RUNNING: &str = "toggle-running";
const MENU_TOGGLE_DRY_RUN: &str = "toggle-dry-run";
const MENU_LAUNCH_ON_LOGIN: &str = "launch-on-login";
const MENU_UNDO: &str = "undo";
const MENU_OPEN_MAIN: &str = "open-main";
const MENU_QUIT: &str = "quit";
const MENU_DIRECTORIES: &str = "directories";

fn get_version_string() -> String {
    let version = env!("CARGO_PKG_VERSION");
    let build_type = if cfg!(debug_assertions) {
        "debug"
    } else if option_env!("NAMEFIX_OFFICIAL_BUILD").is_some() {
        "release"
    } else {
        "local"
    };
    format!("v{} ({})", version, build_type)
}

#[derive(Clone)]
pub struct TrayState {
    tray: TrayIcon<Wry>,
    status_label: MenuItem<Wry>,
    toggle_running: MenuItem<Wry>,
    dry_run: CheckMenuItem<Wry>,
    launch_on_login: CheckMenuItem<Wry>,
    undo: MenuItem<Wry>,
    directories: Submenu<Wry>,
    current_status: Arc<Mutex<ServiceStatus>>,
}

impl TrayState {
    fn apply_status(&self, app: &AppHandle<Wry>, status: &ServiceStatus) -> tauri::Result<()> {
        let mut writable = self.current_status.lock().expect("status lock poisoned");
        *writable = status.clone();

        let run_label = if status.running { "Pause Watching" } else { "Start Watching" };
        self.toggle_running.set_text(run_label)?;
        self.dry_run.set_checked(status.dry_run)?;
        self.launch_on_login.set_checked(status.launch_on_login)?;

        let directories_label = if status.directories.is_empty() {
            "Status: Paused (no directories)".to_string()
        } else if status.running {
            format!("Status: Watching {} dir{}", status.directories.len(), if status.directories.len() == 1 { "" } else { "s" })
        } else {
            "Status: Paused".to_string()
        };
        self.status_label.set_text(directories_label)?;

        rebuild_directories(app, &self.directories, &status.directories)?;
        Ok(())
    }

    fn status(&self) -> ServiceStatus {
        self.current_status.lock().expect("status lock poisoned").clone()
    }
}

pub fn init_tray(app: &AppHandle<Wry>, bridge: &BridgeState) -> tauri::Result<TrayState> {
    let version_item = MenuItem::with_id(app, MENU_VERSION, get_version_string(), true, None::<&str>)?;
    version_item.set_enabled(false)?;

    let status_item = MenuItem::with_id(app, MENU_STATUS, "Status: Loading…", true, None::<&str>)?;
    status_item.set_enabled(false)?;

    let toggle_running = MenuItem::with_id(app, MENU_TOGGLE_RUNNING, "Start Watching", true, None::<&str>)?;
    let dry_run = CheckMenuItem::with_id(app, MENU_TOGGLE_DRY_RUN, "Dry Run", true, true, None::<&str>)?;
    let launch_on_login = CheckMenuItem::with_id(app, MENU_LAUNCH_ON_LOGIN, "Launch on Login", true, false, None::<&str>)?;
    let undo = MenuItem::with_id(app, MENU_UNDO, "Undo Last Rename", true, None::<&str>)?;
    let open_main = MenuItem::with_id(app, MENU_OPEN_MAIN, "Preferences...", true, None::<&str>)?;
    let quit_item = PredefinedMenuItem::quit(app, Some("Quit Namefix"))?;

    let directories = SubmenuBuilder::with_id(app, MENU_DIRECTORIES, "Directories").build()?;

    let menu = MenuBuilder::new(app)
        .item(&version_item)
        .item(&status_item)
        .separator()
        .item(&toggle_running)
        .item(&dry_run)
        .item(&launch_on_login)
        .item(&undo)
        .separator()
        .item(&directories)
        .separator()
        .item(&open_main)
        .item(&quit_item)
        .build()?;

    let tray_icon = TrayIconBuilder::with_id("namefix-tray")
        .menu(&menu)
        .icon(tray_icon_image()?)
        .icon_as_template(false)
        .tooltip("Namefix")
        .on_menu_event(move |app, event| {
            let event_id = event.id().0.clone();
            let app_handle = app.clone();
            log::info!("Tray menu event received: {}", event_id);
            async_runtime::spawn(async move {
                let bridge_state = app_handle.state::<BridgeState>();
                let bridge = bridge_state.inner().clone();
                drop(bridge_state);

                log::info!("Processing menu action: {}", event_id);
                let action_result: Result<(), String> = match event_id.as_str() {
                    MENU_TOGGLE_RUNNING => {
                        log::info!("Calling toggle_running on bridge");
                        let result = bridge::toggle_running(&bridge, None).await;
                        log::info!("toggle_running result: {:?}", result);
                        result.map(|_| ())
                    }
                    MENU_TOGGLE_DRY_RUN => {
                        let tray_state = app_handle.state::<TrayState>().inner().clone();
                        let current = tray_state.status();
                        bridge::set_dry_run(&bridge, !current.dry_run).await.map(|_| ())
                    }
                    MENU_LAUNCH_ON_LOGIN => {
                        let tray_state = app_handle.state::<TrayState>().inner().clone();
                        let current = tray_state.status();
                        bridge::set_launch_on_login(&bridge, !current.launch_on_login).await.map(|_| ())
                    }
                    MENU_UNDO => {
                        bridge::undo(&bridge).await.map(|_| ())
                    }
                    MENU_OPEN_MAIN => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        Ok(())
                    }
                    MENU_QUIT => {
                        app_handle.exit(0);
                        Ok(())
                    }
                    _ => Ok(()),
                };

                // Log errors and emit toast for user feedback
                if let Err(ref err) = action_result {
                    log::error!("Menu action '{}' failed: {}", event_id, err);
                    let _ = app_handle.emit("service://toast", serde_json::json!({
                        "message": format!("Action failed: {}", err),
                        "level": "error"
                    }));
                }

                // Force status refresh to ensure tray reflects actual state
                // This is critical because the async spawn doesn't block the menu event
                log::info!("Fetching status after action");
                match bridge::get_status(&bridge).await {
                    Ok(status) => {
                        log::info!("Got status: running={}, dirs={}", status.running, status.directories.len());
                        if let Some(tray_state) = app_handle.try_state::<TrayState>() {
                            if let Err(err) = tray_state.apply_status(&app_handle, &status) {
                                log::error!("Failed to update tray after action: {}", err);
                            } else {
                                log::info!("Tray updated successfully");
                            }
                        } else {
                            log::error!("TrayState not available");
                        }
                    }
                    Err(err) => {
                        log::error!("Failed to get status after action: {}", err);
                    }
                }
            });
        })
        .build(app)?;

    let initial_status = async_runtime::block_on(bridge::get_status(bridge))
        .unwrap_or(ServiceStatus { running: false, directories: vec![], dry_run: true, launch_on_login: false });

    let tray_state = TrayState {
        tray: tray_icon,
        status_label: status_item,
        toggle_running,
        dry_run,
        launch_on_login,
        undo,
        directories,
        current_status: Arc::new(Mutex::new(initial_status.clone())),
    };

    tray_state.apply_status(app, &initial_status)?;

    Ok(tray_state)
}

pub fn register_status_listener(app: &AppHandle<Wry>) {
    let app_handle = app.clone();
    app.listen_any("service://status", move |event| {
        let payload = event.payload();
        if let Ok(status) = serde_json::from_str::<ServiceStatus>(payload) {
            if let Some(tray_state) = app_handle.try_state::<TrayState>() {
                if let Err(err) = tray_state.apply_status(&app_handle, &status) {
                    log::error!("failed to update tray: {}", err);
                }
            }
        }
    });
}

fn rebuild_directories(app: &AppHandle<Wry>, submenu: &Submenu<Wry>, directories: &[String]) -> tauri::Result<()> {
    let existing = submenu.items()?;
    for item in existing {
        submenu.remove(&item)?;
    }

    if directories.is_empty() {
        let empty = MenuItem::new(app, "No directories configured", false, None::<&str>)?;
        empty.set_enabled(false)?;
        submenu.append(&empty)?;
    } else {
        for dir in directories {
            let path = Path::new(dir);
            let display = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_string())
                .unwrap_or_else(|| dir.clone());
            let item = MenuItem::new(app, display, false, None::<&str>)?;
            item.set_enabled(false)?;
            submenu.append(&item)?;
        }
    }

    Ok(())
}

fn tray_icon_image() -> tauri::Result<Image<'static>> {
    const SIZE: u32 = 28;
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let max = (SIZE - 1) as f32;
    let center = max / 2.0;
    let base_radius = SIZE as f32 * 0.48;
    let halo_radius = base_radius + 2.2;

    let doc_left = 7.5;
    let doc_right = SIZE as f32 - 7.5;
    let doc_top = 8.0;
    let doc_bottom = SIZE as f32 - 8.5;
    let doc_radius = 4.2;

    let in_round_rect = |xf: f32, yf: f32| -> bool {
        if xf < doc_left || xf > doc_right || yf < doc_top || yf > doc_bottom {
            return false;
        }
        let inner_left = doc_left + doc_radius;
        let inner_right = doc_right - doc_radius;
        let inner_top = doc_top + doc_radius;
        let inner_bottom = doc_bottom - doc_radius;
        if (xf >= inner_left && xf <= inner_right) || (yf >= inner_top && yf <= inner_bottom) {
            return true;
        }
        let corner_x = if xf < inner_left { inner_left } else { inner_right };
        let corner_y = if yf < inner_top { inner_top } else { inner_bottom };
        let dx = xf - corner_x;
        let dy = yf - corner_y;
        (dx * dx + dy * dy) <= doc_radius * doc_radius
    };

    let folded_corner_threshold = doc_right + doc_top - doc_radius;
    let in_folded_corner = |xf: f32, yf: f32| -> bool {
        xf > doc_right - doc_radius && yf < doc_top + doc_radius && (xf + yf) > folded_corner_threshold
    };

    let diagonal_normalization = (1.5_f32).sqrt();
    for y in 0..SIZE {
        for x in 0..SIZE {
            let idx = ((y * SIZE + x) * 4) as usize;
            let xf = x as f32;
            let yf = y as f32;
            let dx = xf - center;
            let dy = yf - center;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist > halo_radius {
                rgba[idx + 3] = 0;
                continue;
            }

            let gradient = ((xf + yf) / (2.0 * max.max(1.0))).clamp(0.0, 1.0);
            let mut r = 18.0 + gradient * 60.0;
            let mut g = 28.0 + gradient * 90.0;
            let mut b = 52.0 + gradient * 120.0;
            let mut alpha = if dist <= base_radius {
                0.92
            } else {
                ((halo_radius - dist) / (halo_radius - base_radius)).clamp(0.0, 1.0) * 0.8
            };

            if in_round_rect(xf, yf) {
                let doc_shade = 0.65 + 0.15 * ((yf - doc_top) / (doc_bottom - doc_top)).clamp(0.0, 1.0);
                r = 220.0 * doc_shade;
                g = 233.0 * doc_shade;
                b = 255.0 * doc_shade;
                alpha = 0.96;

                // folded corner
                if in_folded_corner(xf, yf) {
                    r = 255.0;
                    g = 249.0;
                    b = 200.0;
                }
            }

            // diagonal rename arrow overlay
            let diagonal_line_y = -1.05 * xf + (center * 2.0 - 2.0);
            let diag = ((yf - diagonal_line_y) / diagonal_normalization).abs();
            if diag < 1.1 && xf >= 10.0 && xf <= doc_right && yf >= doc_top + 2.0 && yf <= doc_bottom + 1.0 {
                r = 82.0;
                g = 223.0;
                b = 205.0;
                alpha = 1.0;
            }
            // arrow head
            if xf > doc_right - 4.5 && yf <= doc_top + 5.5 {
                let tip = (yf - (doc_top + 1.0)) - (-(xf - (doc_right - 1.5)));
                if tip <= 0.8 {
                    r = 98.0;
                    g = 228.0;
                    b = 210.0;
                    alpha = 1.0;
                }
            }

            rgba[idx] = (r.clamp(0.0, 255.0) * 1.0) as u8;
            rgba[idx + 1] = (g.clamp(0.0, 255.0) * 1.0) as u8;
            rgba[idx + 2] = (b.clamp(0.0, 255.0) * 1.0) as u8;
            rgba[idx + 3] = (alpha.clamp(0.0, 1.0) * 255.0) as u8;
        }
    }

    Ok(Image::new_owned(rgba, SIZE, SIZE))
}
