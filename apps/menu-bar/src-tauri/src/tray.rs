use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::{
    async_runtime,
    image::Image,
    menu::{CheckMenuItem, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager, Runtime, Wry,
};

use crate::bridge::{self, BridgeState, ServiceStatus};

const MENU_STATUS: &str = "status-label";
const MENU_TOGGLE_RUNNING: &str = "toggle-running";
const MENU_TOGGLE_DRY_RUN: &str = "toggle-dry-run";
const MENU_LAUNCH_ON_LOGIN: &str = "launch-on-login";
const MENU_UNDO: &str = "undo";
const MENU_OPEN_MAIN: &str = "open-main";
const MENU_QUIT: &str = "quit";
const MENU_DIRECTORIES: &str = "directories";

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
    let status_item = MenuItem::with_id(app, MENU_STATUS, "Status: Loading…", true, None::<&str>)?;
    status_item.set_enabled(false)?;

    let toggle_running = MenuItem::with_id(app, MENU_TOGGLE_RUNNING, "Start Watching", true, None::<&str>)?;
    let dry_run = CheckMenuItem::with_id(app, MENU_TOGGLE_DRY_RUN, "Dry Run", true, true, None::<&str>)?;
    let launch_on_login = CheckMenuItem::with_id(app, MENU_LAUNCH_ON_LOGIN, "Launch on Login", true, false, None::<&str>)?;
    let undo = MenuItem::with_id(app, MENU_UNDO, "Undo Last Rename", true, None::<&str>)?;
    let open_main = MenuItem::with_id(app, MENU_OPEN_MAIN, "Open Window", true, None::<&str>)?;
    let quit_item = PredefinedMenuItem::quit(app, Some("Quit Namefix"))?;

    let directories = SubmenuBuilder::with_id(app, MENU_DIRECTORIES, "Directories").build()?;

    let menu = MenuBuilder::new(app)
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
        .icon_as_template(true)
        .tooltip("Namefix")
        .on_menu_event(move |app, event| {
            let event_id = event.id().to_string();
            let app_handle = app.clone();
            async_runtime::spawn(async move {
                let bridge_state = app_handle.state::<BridgeState>();
                let bridge = bridge_state.inner().clone();
                drop(bridge_state);
                match event_id.as_str() {
                    MENU_TOGGLE_RUNNING => {
                        if let Err(err) = bridge::toggle_running(&bridge, None).await {
                            log::error!("toggle_running failed: {}", err);
                        }
                    }
                    MENU_TOGGLE_DRY_RUN => {
                        let tray_state = app_handle.state::<TrayState>().inner().clone();
                        let current = tray_state.status();
                        if let Err(err) = bridge::set_dry_run(&bridge, !current.dry_run).await {
                            log::error!("set_dry_run failed: {}", err);
                        }
                    }
                    MENU_LAUNCH_ON_LOGIN => {
                        let tray_state = app_handle.state::<TrayState>().inner().clone();
                        let current = tray_state.status();
                        if let Err(err) = bridge::set_launch_on_login(&bridge, !current.launch_on_login).await {
                            log::error!("set_launch_on_login failed: {}", err);
                        }
                    }
                    MENU_UNDO => {
                        if let Err(err) = bridge::undo(&bridge).await {
                            log::error!("undo failed: {}", err);
                        }
                    }
                    MENU_OPEN_MAIN => {
                        if let Some(window) = app_handle.get_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    MENU_QUIT => {
                        app_handle.exit(0);
                    }
                    _ => {}
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
    app.listen_global("service://status", move |event| {
        if let Some(payload) = event.payload() {
            if let Ok(status) = serde_json::from_str::<ServiceStatus>(payload) {
                if let Some(tray_state) = app_handle.try_state::<TrayState>() {
                    if let Err(err) = tray_state.apply_status(&app_handle, &status) {
                        log::error!("failed to update tray: {}", err);
                    }
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
    const SIZE: u32 = 18;
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let center = (SIZE as f32 - 1.0) / 2.0;
    let radius = SIZE as f32 * 0.35;

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let dist = (dx * dx + dy * dy).sqrt();
            let offset = ((y * SIZE + x) * 4) as usize;
            if dist <= radius {
                rgba[offset] = 255;
                rgba[offset + 1] = 255;
                rgba[offset + 2] = 255;
                rgba[offset + 3] = 255;
            } else {
                rgba[offset..offset + 4].copy_from_slice(&[0, 0, 0, 0]);
            }
        }
    }

    Ok(Image::new_owned(rgba, SIZE, SIZE))
}
