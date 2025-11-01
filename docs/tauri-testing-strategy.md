# Tauri Menu Bar Testing Strategy

_Last updated: October 30, 2025_

This document captures the pre-bridge testing approach so we can wire the menu bar UI without regressing the existing CLI/TUI experience.

## Rust Layer
- **Command unit tests (`cargo test`)**: add focused tests around each Tauri command module (e.g., `ipc.rs`) once implementations land. Use dependency injection for the bridge and stub the Node channel to assert request payloads.
- **Capability sanity checks**: add a smoke test ensuring the configured capabilities compile and that the autostart plugin is registered (prevents regressions when bumping plugin versions).

## Node Bridge Layer
- **Vitest integration tests**: exercise the forthcoming IPC bridge module by mocking the Tauri invoke API and asserting calls into `NamefixService`. Reuse the existing service fixtures to avoid duplication.
- **Contract validation**: generate shared TypeScript types from `ServiceEventMap` (via `ts-json-schema-generator` or manual exports) and fail tests if the contract diverges from the Rust payload shapes.
- **Safety note**: always drive the Node bridge (`service-bridge.mjs`) through Tauri or a dedicated harness that issues an explicit `shutdown` request. Running the script directly in the foreground will block the shell while it waits on stdin, so automation must spawn it in the background and terminate cleanly.

## Frontend Shell
- **Component tests**: once we introduce UI components (menu, preferences window), cover them with `@testing-library` or `vitest` DOM tests to ensure state changes reflect command responses.
- **Playwright smoke**: on macOS CI, drive the tray build via `pnpm tauri dev` and capture key flows (status refresh, toggles, directory management). Keep this optional until CI resources are available.

## Tooling Hooks
- Gate `npm run tauri:dev` with workspace dependency checks (ensure `pnpm install` succeeded) and document fallback commands for contributors.
- Extend the existing `npm run test` suite with a `--filter menu-bar` target once the bridge is in place, so we can run frontend-only tests in isolation.

## Next Steps
1. Land the Node bridge module with dependency injection to enable command unit tests.
2. Stand up Vitest integration suites that mock invoke/emit behaviour.
3. Add CI job scaffolding for macOS-specific smoke runs before Phase 5 UI polish.
