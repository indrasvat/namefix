# Tauri 2.x Development Guide for Namefix

This comprehensive guide covers Tauri 2.x features, best practices, and plugin recommendations specifically tailored for the Namefix menu bar application. Last updated: December 2025.

## Table of Contents

1. [Tauri 2.0 Overview](#tauri-20-overview)
2. [Core Architecture Changes](#core-architecture-changes)
3. [System Tray and Menu Bar APIs](#system-tray-and-menu-bar-apis)
4. [State Management](#state-management)
5. [IPC and Commands](#ipc-and-commands)
6. [Error Handling Patterns](#error-handling-patterns)
7. [Permissions and Capabilities](#permissions-and-capabilities)
8. [Recommended Plugins](#recommended-plugins)
9. [Testing Strategies](#testing-strategies)
10. [CI/CD with GitHub Actions](#cicd-with-github-actions)
11. [Performance Optimization](#performance-optimization)
12. [Migration from Tauri 1.x](#migration-from-tauri-1x)

---

## Tauri 2.0 Overview

Tauri 2.0 was released in October 2024 and represents a major evolution of the framework. The primary headline feature is mobile support (iOS/Android), but it includes substantial improvements for desktop apps as well.

### Key New Features

| Feature | Description | Relevance to Namefix |
|---------|-------------|---------------------|
| **Mobile Support** | Build for iOS and Android from the same codebase | Future expansion potential |
| **Advanced Plugin System** | Modular architecture with first-party plugins | Better maintainability |
| **New Permissions System** | Replaces the v1 allowlist with capabilities | Enhanced security |
| **Multiple WebViews** | Multiple webviews in a single window | Multi-panel preferences UI |
| **Raw Payloads IPC** | Serialization-free data transfer for performance | Large file operations |
| **Channel API** | Stream data from Rust to frontend | Real-time rename events |
| **Native Context Menus** | Rust and JavaScript APIs via muda | Tray menu enhancements |
| **JavaScript Menu/Tray APIs** | Configure menus from frontend code | Dynamic menu updates |

### Official Documentation

- [Tauri 2.0 Stable Release Blog](https://v2.tauri.app/blog/tauri-20/)
- [Official Tauri v2 Documentation](https://v2.tauri.app/)
- [Tauri Plugins Workspace](https://github.com/tauri-apps/plugins-workspace)

---

## Core Architecture Changes

### Feature Flag Rename: `system-tray` to `tray-icon`

In Tauri 2.0, the `system-tray` feature flag was renamed to `tray-icon`. The Namefix `Cargo.toml` already uses the correct feature:

```toml
# apps/menu-bar/src-tauri/Cargo.toml
[dependencies]
tauri = { version = "2.5.1", features = ["tray-icon", "image-png"] }
```

### TrayIconBuilder Replaces system_tray

The v1 `tauri::Builder::system_tray` was removed. Tauri 2.0 requires using `TrayIconBuilder` inside the `setup` hook:

```rust
// Namefix implementation in src-tauri/src/tray.rs
use tauri::tray::{TrayIcon, TrayIconBuilder};

pub fn init_tray(app: &AppHandle<Wry>, bridge: &BridgeState) -> tauri::Result<TrayState> {
    let tray_icon = TrayIconBuilder::with_id("namefix-tray")
        .menu(&menu)
        .icon(tray_icon_image()?)
        .icon_as_template(false)
        .tooltip("Namefix")
        .on_menu_event(move |app, event| {
            // Handle menu events
        })
        .build(app)?;

    // ...
}
```

### Window Type Renamed

The Rust `Window` type was renamed to `WebviewWindow`, and `get_window` to `get_webview_window`:

```rust
// Tauri 2.0 syntax
if let Some(window) = app_handle.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
}
```

### Module Path Changes

JavaScript API imports changed:

```javascript
// Tauri 1.x
import { invoke } from '@tauri-apps/api/tauri';
import { WebviewWindow } from '@tauri-apps/api/window';

// Tauri 2.x
import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
```

---

## System Tray and Menu Bar APIs

Namefix is a menu bar app, making system tray APIs critical. Tauri 2.0 provides both Rust and JavaScript APIs.

### Rust Tray API

The tray API uses `TrayIconBuilder` with support for:

- Dynamic menu construction
- Menu event handling
- Icon customization
- Tooltips

```rust
use tauri::{
    menu::{CheckMenuItem, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder},
    tray::{TrayIcon, TrayIconBuilder},
};

// Build a menu with various item types
let menu = MenuBuilder::new(app)
    .item(&version_item)
    .item(&status_item)
    .separator()
    .item(&toggle_running)
    .item(&dry_run)        // CheckMenuItem
    .item(&launch_on_login) // CheckMenuItem
    .separator()
    .item(&directories)     // Submenu
    .separator()
    .item(&open_main)
    .item(&quit_item)       // PredefinedMenuItem::quit
    .build()?;
```

### Dynamic Menu Updates

Menus can be updated dynamically after creation:

```rust
impl TrayState {
    fn apply_status(&self, app: &AppHandle<Wry>, status: &ServiceStatus) -> tauri::Result<()> {
        // Update menu item text
        let run_label = if status.running { "Pause Watching" } else { "Start Watching" };
        self.toggle_running.set_text(run_label)?;

        // Update checkbox states
        self.dry_run.set_checked(status.dry_run)?;
        self.launch_on_login.set_checked(status.launch_on_login)?;

        // Rebuild dynamic submenus
        rebuild_directories(app, &self.directories, &status.directories)?;
        Ok(())
    }
}
```

### Submenu Rebuilding

For dynamic content like directories, rebuild the submenu:

```rust
fn rebuild_directories(app: &AppHandle<Wry>, submenu: &Submenu<Wry>, directories: &[String]) -> tauri::Result<()> {
    // Clear existing items
    let existing = submenu.items()?;
    for item in existing {
        submenu.remove(&item)?;
    }

    // Add new items
    if directories.is_empty() {
        let empty = MenuItem::new(app, "No directories configured", false, None::<&str>)?;
        empty.set_enabled(false)?;
        submenu.append(&empty)?;
    } else {
        for dir in directories {
            let display = Path::new(dir)
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
```

### JavaScript Tray API

For frontend-driven tray updates (available since Tauri 2.0):

```typescript
import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu, MenuItem, CheckMenuItem } from '@tauri-apps/api/menu';

// Create tray from JavaScript
const tray = await TrayIcon.new({
    id: 'my-tray',
    tooltip: 'My App',
    icon: 'icons/icon.png',
    menu: await Menu.new({
        items: [
            await MenuItem.new({ id: 'open', text: 'Open' }),
            await CheckMenuItem.new({ id: 'enabled', text: 'Enabled', checked: true }),
        ]
    })
});

// Listen for events
tray.onMenuEvent((event) => {
    console.log('Menu item clicked:', event.id);
});
```

### macOS-Specific: Accessory Activation Policy

For menu bar apps that shouldn't appear in the Dock:

```rust
#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(ActivationPolicy::Accessory);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

### Hide on Close Pattern

Keep the app running when the window is closed:

```rust
.on_window_event(|window, event| {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
})
```

---

## State Management

Tauri provides built-in state management via the `Manager` API.

### Defining State Types

```rust
use std::sync::{Arc, Mutex};

// Simple state
pub struct AppConfig {
    pub theme: String,
    pub language: String,
}

// Thread-safe mutable state
pub struct Counter {
    pub value: Arc<Mutex<i32>>,
}

// Async-safe state (for use in async commands)
use tauri::async_runtime::Mutex as AsyncMutex;

pub struct AsyncState {
    pub data: AsyncMutex<Vec<String>>,
}
```

### Registering State

State is registered in the `setup` hook:

```rust
.setup(|app| {
    // Register multiple state types
    app.manage(BridgeState::new());
    app.manage(TrayState::new());
    app.manage(Counter { value: Arc::new(Mutex::new(0)) });
    Ok(())
})
```

### Accessing State in Commands

```rust
#[tauri::command]
pub async fn get_status(state: tauri::State<'_, BridgeState>) -> tauri::Result<ServiceStatus> {
    // Access state via .inner() or deref
    let bridge = state.inner();
    bridge.get_status().await.map_err(|e| tauri::Error::Anyhow(anyhow!(e)))
}
```

### Accessing State from Event Handlers

Use `try_state()` for optional access:

```rust
.on_menu_event(move |app, event| {
    let app_handle = app.clone();
    async_runtime::spawn(async move {
        // Access state from spawned task
        let bridge_state = app_handle.state::<BridgeState>();
        let bridge = bridge_state.inner().clone();

        // Optional access (returns None if not registered)
        if let Some(tray_state) = app_handle.try_state::<TrayState>() {
            tray_state.update();
        }
    });
})
```

### Best Practices for State

1. **Unique State Types**: Each state type must be unique. Use wrapper structs if needed.
2. **Thread Safety**: Use `Mutex` for synchronous access, `tokio::sync::Mutex` for async.
3. **Avoid Deadlocks**: Release locks before awaiting async operations.
4. **State Cloning**: Clone state before dropping the guard in async contexts.

```rust
// Correct pattern for async handlers
async_runtime::spawn(async move {
    // Get and clone the state, then drop the guard
    let bridge_state = app_handle.state::<BridgeState>();
    let bridge = bridge_state.inner().clone();
    drop(bridge_state);

    // Now safe to await
    let result = bridge.invoke("method", params).await;
});
```

---

## IPC and Commands

### Defining Commands

Commands are Rust functions exposed to the frontend:

```rust
#[tauri::command]
pub async fn add_watch_dir(
    state: tauri::State<'_, BridgeState>,
    directory: String,
) -> tauri::Result<Vec<String>> {
    bridge::add_watch_dir(&state, directory)
        .await
        .map_err(|err| tauri::Error::Anyhow(anyhow!(err)))
}
```

### Registering Commands

```rust
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        add_watch_dir,
        delete_profile,
        get_profile,
        get_profiles,
        get_status,
        // ... more commands
    ])
```

### Calling Commands from JavaScript

```typescript
import { invoke } from '@tauri-apps/api/core';

// Basic invocation
const status = await invoke<ServiceStatus>('get_status');

// With arguments
const directories = await invoke<string[]>('add_watch_dir', {
    directory: '/Users/me/Screenshots'
});
```

### Event System

Events provide bidirectional communication:

```rust
use tauri::{Emitter, Listener};

// Emit event from Rust
app_handle.emit("service://status", &status)?;

// Listen for events in Rust
app.listen_any("service://status", move |event| {
    let payload = event.payload();
    if let Ok(status) = serde_json::from_str::<ServiceStatus>(payload) {
        // Handle status update
    }
});
```

```typescript
import { listen, emit } from '@tauri-apps/api/event';

// Listen for events in JavaScript
const unlisten = await listen('service://status', (event) => {
    console.log('Status update:', event.payload);
});

// Emit event from JavaScript
await emit('frontend://action', { type: 'refresh' });
```

### Channel API (New in 2.0)

For streaming data from Rust to frontend:

```rust
use tauri::ipc::Channel;

#[tauri::command]
async fn stream_events(channel: Channel<FileEvent>) -> Result<(), String> {
    // Send multiple events over time
    channel.send(FileEvent { name: "file1.png".into() })?;
    channel.send(FileEvent { name: "file2.png".into() })?;
    Ok(())
}
```

```typescript
import { invoke, Channel } from '@tauri-apps/api/core';

const channel = new Channel<FileEvent>();
channel.onmessage = (event) => {
    console.log('Received:', event);
};

await invoke('stream_events', { channel });
```

---

## Error Handling Patterns

### The Challenge

Tauri commands must return `Result<T, E>` where `E: serde::Serialize`. Most Rust error types don't implement `Serialize`.

### Pattern 1: Map to String (Simple)

```rust
#[tauri::command]
async fn simple_command() -> Result<String, String> {
    do_something().map_err(|e| e.to_string())
}
```

### Pattern 2: Custom Error Type with thiserror (Recommended)

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Bridge error: {0}")]
    Bridge(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

// Implement Serialize for frontend consumption
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
async fn typed_command() -> Result<Data, AppError> {
    let data = fetch_data()?;  // ? works with #[from]
    Ok(data)
}
```

### Pattern 3: Namefix Approach (Using anyhow)

The Namefix codebase wraps errors into `tauri::Error::Anyhow`:

```rust
use anyhow::anyhow;

fn map_bridge_err<T>(result: Result<T, String>) -> tauri::Result<T> {
    result.map_err(|err| tauri::Error::Anyhow(anyhow!(err)))
}

#[tauri::command]
pub async fn get_status(state: tauri::State<'_, BridgeState>) -> tauri::Result<ServiceStatus> {
    map_bridge_err(bridge::get_status(&state).await)
}
```

### Frontend Error Handling

```typescript
try {
    const result = await invoke('get_status');
    // Handle success
} catch (error) {
    // error is the serialized error string
    console.error('Command failed:', error);
    showToast({ message: `Failed: ${error}`, level: 'error' });
}
```

### Important Warning

**Never panic in commands!** Synchronous command panics crash the app. Async panics leave promises unresolved.

```rust
// BAD - will crash
#[tauri::command]
fn bad_command() -> String {
    panic!("oops");
}

// GOOD - return error
#[tauri::command]
fn good_command() -> Result<String, String> {
    Err("Something went wrong".into())
}
```

---

## Permissions and Capabilities

Tauri 2.0 replaces the v1 allowlist with a more granular capabilities system.

### Capability Files

Capabilities are defined in `src-tauri/capabilities/`:

```json
// capabilities/menu-bar.json
{
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "menu-bar",
    "description": "Baseline capability set for the Namefix menu bar companion.",
    "windows": ["main"],
    "permissions": [
        { "identifier": "core:app:default" },
        { "identifier": "core:window:default" },
        { "identifier": "core:event:default" },
        { "identifier": "core:path:default" },
        { "identifier": "core:tray:default" },
        { "identifier": "autostart:allow-enable" },
        { "identifier": "autostart:allow-disable" }
    ]
}
```

### Referencing Capabilities

```json
// tauri.conf.json
{
    "app": {
        "security": {
            "csp": null,
            "capabilities": ["menu-bar"]
        }
    }
}
```

### Permission Types

| Type | Description |
|------|-------------|
| `core:*:default` | Default safe permissions for core features |
| `plugin:allow-*` | Allow specific plugin commands |
| `plugin:deny-*` | Explicitly deny commands |

### Platform-Specific Capabilities

```json
{
    "identifier": "desktop-only",
    "platforms": ["linux", "macOS", "windows"],
    "permissions": [...]
}
```

### Window-Specific Permissions

```json
{
    "identifier": "main-window-caps",
    "windows": ["main", "settings"],
    "permissions": [...]
}
```

### Plugin Permissions

Each plugin defines its own permissions. Check plugin documentation for available permissions:

```json
{
    "permissions": [
        "autostart:allow-enable",
        "autostart:allow-disable",
        "autostart:allow-is-enabled",
        "notification:default",
        "store:default",
        "shell:allow-spawn"
    ]
}
```

---

## Recommended Plugins

### tauri-plugin-autostart

Already used in Namefix. Enables launch-on-login functionality.

**Installation:**

```toml
# Cargo.toml
tauri-plugin-autostart = { version = "2.5.1" }
```

```bash
pnpm add @tauri-apps/plugin-autostart
```

**Setup:**

```rust
// main.rs
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

tauri::Builder::default()
    .plugin(autostart_plugin())
```

**Usage:**

```typescript
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

await enable();
await disable();
const enabled = await isEnabled();
```

**Capabilities:**

```json
{
    "permissions": [
        "autostart:allow-enable",
        "autostart:allow-disable",
        "autostart:allow-is-enabled"
    ]
}
```

### tauri-plugin-store

Persistent key-value storage. Useful for user preferences.

**Installation:**

```toml
tauri-plugin-store = { version = "2.4.0" }
```

```bash
pnpm add @tauri-apps/plugin-store
```

**Setup:**

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::default().build())
```

**Usage:**

```typescript
import { LazyStore } from '@tauri-apps/plugin-store';

const store = new LazyStore('settings.json');

// Get/set values
await store.set('theme', 'dark');
const theme = await store.get<string>('theme');

// Save to disk
await store.save();

// Listen for changes
await store.onKeyChange('theme', (value) => {
    console.log('Theme changed to:', value);
});
```

**Rust Usage:**

```rust
use tauri_plugin_store::StoreExt;

// In a command or setup
let store = app.store("settings.json")?;
store.set("key", serde_json::json!("value"));
store.save()?;
```

### tauri-plugin-notification

Native system notifications.

**Installation:**

```toml
tauri-plugin-notification = { version = "2.3.3" }
```

```bash
pnpm add @tauri-apps/plugin-notification
```

**Setup:**

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
```

**Usage:**

```typescript
import {
    isPermissionGranted,
    requestPermission,
    sendNotification
} from '@tauri-apps/plugin-notification';

// Check/request permission
let granted = await isPermissionGranted();
if (!granted) {
    granted = await requestPermission() === 'granted';
}

// Send notification
if (granted) {
    sendNotification({
        title: 'Namefix',
        body: 'Screenshot renamed: meeting-notes.png',
    });
}
```

**Capabilities:**

```json
{
    "permissions": ["notification:default"]
}
```

### tauri-plugin-shell

Execute system commands and open URLs/files.

**Installation:**

```toml
tauri-plugin-shell = { version = "2.2.1" }
```

```bash
pnpm add @tauri-apps/plugin-shell
```

**Setup:**

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
```

**Usage:**

```typescript
import { open } from '@tauri-apps/plugin-shell';

// Open URL in default browser
await open('https://github.com/');

// Open file in default application
await open('/path/to/file.pdf');

// Open folder in Finder
await open('/Users/me/Screenshots');
```

**Spawning Processes:**

```typescript
import { Command } from '@tauri-apps/plugin-shell';

const command = Command.create('node', ['--version']);
const output = await command.execute();
console.log(output.stdout);
```

**Capabilities (security-sensitive):**

```json
{
    "permissions": [
        "shell:allow-open",
        {
            "identifier": "shell:allow-spawn",
            "allow": [
                { "name": "node", "args": true }
            ]
        }
    ]
}
```

### tauri-plugin-updater

Auto-update functionality.

**Installation:**

```toml
tauri-plugin-updater = { version = "2.9.0" }
```

```bash
pnpm add @tauri-apps/plugin-updater
```

**Configuration:**

```json
// tauri.conf.json
{
    "bundle": {
        "createUpdaterArtifacts": true
    },
    "plugins": {
        "updater": {
            "endpoints": [
                "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}"
            ],
            "pubkey": "YOUR_PUBLIC_KEY"
        }
    }
}
```

**Usage:**

```typescript
import { check, Update } from '@tauri-apps/plugin-updater';

const update = await check();
if (update) {
    console.log(`Update available: ${update.version}`);

    // Download and install
    await update.downloadAndInstall((progress) => {
        console.log(`Downloaded ${progress.downloaded}/${progress.total} bytes`);
    });
}
```

### Other Useful Plugins

| Plugin | Use Case |
|--------|----------|
| `tauri-plugin-fs` | File system access |
| `tauri-plugin-dialog` | Native file/folder dialogs |
| `tauri-plugin-clipboard-manager` | Clipboard operations |
| `tauri-plugin-global-shortcut` | System-wide keyboard shortcuts |
| `tauri-plugin-log` | Structured logging |

---

## Testing Strategies

### Unit Testing with Vitest

**Setup:**

```bash
pnpm add -D vitest jsdom @vitest/coverage-v8
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
    },
});
```

**Mocking Tauri APIs:**

```typescript
// src/test/setup.ts
import { vi } from 'vitest';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';

beforeAll(() => {
    mockWindows('main');
});

beforeEach(() => {
    mockIPC((cmd, args) => {
        switch (cmd) {
            case 'get_status':
                return { running: true, directories: [], dryRun: false };
            case 'toggle_running':
                return { running: !args.desired };
            default:
                return null;
        }
    });
});
```

**Example Test:**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

describe('Service Status', () => {
    it('should return current status', async () => {
        const status = await invoke('get_status');
        expect(status.running).toBe(true);
    });
});
```

### Rust Backend Testing

```rust
// src/bridge.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_status_serialization() {
        let status = ServiceStatus {
            running: true,
            directories: vec!["/path".to_string()],
            dry_run: false,
            launch_on_login: true,
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"running\":true"));
    }
}
```

### E2E Testing with Playwright

```typescript
// e2e/app.spec.ts
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    // Start Tauri dev server before tests
    await page.goto('http://localhost:5173');
});

test('preferences window loads', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
});

test('can toggle dry run mode', async ({ page }) => {
    const checkbox = page.getByLabel('Dry Run');
    await checkbox.click();
    await expect(checkbox).toBeChecked();
});
```

---

## CI/CD with GitHub Actions

### Basic Build Workflow

```yaml
# .github/workflows/build.yml
name: Build

on:
    push:
        branches: [main]
    pull_request:
        branches: [main]

jobs:
    build:
        strategy:
            fail-fast: false
            matrix:
                platform: [macos-latest, ubuntu-22.04, windows-latest]

        runs-on: ${{ matrix.platform }}

        steps:
            - uses: actions/checkout@v4

            - name: Setup Node.js
              uses: actions/setup-node@v4
              with:
                  node-version: '22'
                  cache: 'pnpm'

            - name: Setup pnpm
              uses: pnpm/action-setup@v2
              with:
                  version: 9

            - name: Install Rust stable
              uses: dtolnay/rust-toolchain@stable

            - name: Rust cache
              uses: swatinem/rust-cache@v2
              with:
                  workspaces: './apps/menu-bar/src-tauri -> target'

            - name: Install dependencies (Ubuntu)
              if: matrix.platform == 'ubuntu-22.04'
              run: |
                  sudo apt-get update
                  sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev

            - name: Install frontend dependencies
              run: pnpm install

            - name: Build
              run: pnpm --filter @namefix/menu-bar run tauri:build
```

### Release Workflow with tauri-action

```yaml
# .github/workflows/release.yml
name: Release

on:
    push:
        tags:
            - 'v*'

jobs:
    release:
        permissions:
            contents: write

        strategy:
            fail-fast: false
            matrix:
                include:
                    - platform: macos-latest
                      args: --target aarch64-apple-darwin
                    - platform: macos-latest
                      args: --target x86_64-apple-darwin
                    - platform: ubuntu-22.04
                      args: ''
                    - platform: windows-latest
                      args: ''

        runs-on: ${{ matrix.platform }}

        steps:
            - uses: actions/checkout@v4

            - name: Setup Node.js
              uses: actions/setup-node@v4
              with:
                  node-version: '22'

            - name: Setup pnpm
              uses: pnpm/action-setup@v2
              with:
                  version: 9

            - name: Install Rust stable
              uses: dtolnay/rust-toolchain@stable
              with:
                  targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

            - name: Install dependencies (Ubuntu)
              if: matrix.platform == 'ubuntu-22.04'
              run: |
                  sudo apt-get update
                  sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev

            - name: Install frontend dependencies
              run: pnpm install

            - name: Build and release
              uses: tauri-apps/tauri-action@v0
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
                  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
                  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}
              with:
                  tagName: v__VERSION__
                  releaseName: 'Namefix v__VERSION__'
                  releaseBody: 'See the changelog for details.'
                  releaseDraft: true
                  prerelease: false
                  args: ${{ matrix.args }}
                  projectPath: './apps/menu-bar'
```

### Linux Dependencies

For Tauri 2.0, use `libwebkit2gtk-4.1-dev` (not 4.0):

```yaml
- name: Install dependencies (Ubuntu)
  if: matrix.platform == 'ubuntu-22.04'
  run: |
      sudo apt-get update
      sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

---

## Performance Optimization

### Build Optimizations

```toml
# Cargo.toml
[profile.release]
lto = true           # Link-time optimization
codegen-units = 1    # Single codegen unit for better optimization
panic = "abort"      # Remove unwinding code
strip = true         # Strip debug symbols
opt-level = 3        # Maximum optimization
```

### Development Build Speed

```toml
# Cargo.toml
[profile.dev]
incremental = true   # Enable incremental compilation
opt-level = 0        # Minimal optimization for faster builds

[profile.dev.package."*"]
opt-level = 2        # Optimize dependencies
```

### rust-analyzer Separate Target

Configure rust-analyzer to use a separate target directory:

```json
// .vscode/settings.json
{
    "rust-analyzer.cargo.targetDir": "target/rust-analyzer"
}
```

This prevents file lock conflicts between `tauri dev` and rust-analyzer.

### Frontend Optimizations

1. **Minification**: Enable in production builds (usually default)
2. **Disable Source Maps**: For production builds
3. **Tree Shaking**: Remove unused code
4. **Asset Compression**: Compress images and other assets

### IPC Performance

For large data transfers, use raw payloads (new in Tauri 2.0):

```rust
use tauri::ipc::Response;

#[tauri::command]
fn get_large_data() -> Response {
    let data: Vec<u8> = load_data();
    Response::new(data)
}
```

### Async Command Best Practices

```rust
// GOOD: Use async for I/O operations
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| e.to_string())
}

// GOOD: Use blocking for CPU-intensive work
#[tauri::command]
async fn compute_hash(data: Vec<u8>) -> String {
    tauri::async_runtime::spawn_blocking(move || {
        expensive_hash_computation(&data)
    })
    .await
    .unwrap()
}
```

---

## Migration from Tauri 1.x

### Automated Migration

Tauri 2.0 CLI includes a migration command:

```bash
cd apps/menu-bar/src-tauri
cargo tauri migrate
```

### Key Breaking Changes

| v1 | v2 | Notes |
|----|-----|-------|
| `tauri::Builder::system_tray` | `TrayIconBuilder` in setup | Build tray in setup hook |
| `Window` | `WebviewWindow` | Type renamed |
| `get_window()` | `get_webview_window()` | Method renamed |
| `@tauri-apps/api/tauri` | `@tauri-apps/api/core` | Module renamed |
| `@tauri-apps/api/window` | `@tauri-apps/api/webviewWindow` | Module renamed |
| `allowlist` | capabilities | New permissions system |
| `tauri-plugin-*-api` | `@tauri-apps/plugin-*` | Plugin package naming |

### Configuration Changes

```json
// v1 tauri.conf.json
{
    "tauri": {
        "allowlist": {
            "all": true
        }
    }
}

// v2 tauri.conf.json
{
    "app": {
        "security": {
            "capabilities": ["default"]
        }
    }
}
```

### Event System Changes

```rust
// v1
app.listen_global("event", |event| {});

// v2
app.listen_any("event", |event| {});
```

### Windows HTTPS Change

On Windows, production apps now use `http://tauri.localhost` instead of `https://`. To preserve IndexedDB/LocalStorage data from v1:

```json
{
    "app": {
        "windows": [
            {
                "useHttpsScheme": true
            }
        ]
    }
}
```

---

## References

### Official Documentation

- [Tauri v2 Documentation](https://v2.tauri.app/)
- [Tauri 2.0 Release Blog](https://v2.tauri.app/blog/tauri-20/)
- [State Management Guide](https://v2.tauri.app/develop/state-management/)
- [System Tray Guide](https://v2.tauri.app/learn/system-tray/)
- [Permissions & Capabilities](https://v2.tauri.app/security/capabilities/)
- [Plugin Development](https://v2.tauri.app/develop/plugins/)
- [Testing Guide](https://v2.tauri.app/develop/tests/)
- [GitHub Actions CI/CD](https://v2.tauri.app/distribute/pipelines/github/)

### Plugin Documentation

- [Autostart Plugin](https://v2.tauri.app/plugin/autostart/)
- [Store Plugin](https://v2.tauri.app/plugin/store/)
- [Notification Plugin](https://v2.tauri.app/plugin/notification/)
- [Shell Plugin](https://v2.tauri.app/plugin/shell/)
- [Updater Plugin](https://v2.tauri.app/plugin/updater/)

### Migration

- [Upgrade from Tauri 1.0](https://v2.tauri.app/start/migrate/from-tauri-1/)
- [Upgrade from Tauri 2.0 Beta](https://v2.tauri.app/start/migrate/from-tauri-2-beta/)

### Community Resources

- [Tauri Tutorials](https://tauritutorials.com/)
- [Error Handling Recipes](https://tbt.qkation.com/posts/tauri-error-handling/)
- [TauRPC - Type-safe IPC](https://github.com/MatsDK/TauRPC)
- [tauri-action on GitHub](https://github.com/tauri-apps/tauri-action)
