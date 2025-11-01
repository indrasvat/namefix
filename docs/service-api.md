# Namefix Service API Contract

_Last updated: October 30, 2025_

The `NamefixService` class (`src/core/NamefixService.ts`) is the shared orchestration layer used by the existing TUI and the upcoming Tauri menu bar companion. It exposes a minimal, event-driven contract that can be bridged to other front-ends via IPC.

## Initialization & Lifecycle

```ts
const service = new NamefixService();
await service.init();
await service.start();
```

- `init(overrides?: Partial<IConfig>)`: Loads persisted configuration, applies optional overrides, and begins watching for configuration changes.
- `start()`: Ensures watchers are running for every configured directory.
- `stop()`: Shuts down active watchers and leaves the service idle.
- `toggleRunning()`: Convenience helper to start or stop based on the current state.

All watcher mutations are serialized via an internal mutex to prevent race conditions when configs change rapidly.

## Events

Events are strongly typed through `ServiceEventMap` (`src/types/service.ts`). The `NamefixService.on` method returns an unsubscribe function and supports the following channels:

| Event   | Payload type            | Description |
|---------|-------------------------|-------------|
| `status` | `ServiceStatus`         | Emitted whenever the running state, watched directories, or dry-run flag changes. |
| `file`   | `ServiceFileEvent`      | Fired for preview/applied/skip/error outcomes while processing files. |
| `config` | `IConfig`               | Broadcast after the configuration store persists new values. |
| `toast`  | `ServiceToastEvent`     | User-facing notifications surfaced to UI layers. |

Example subscription:

```ts
const off = service.on('status', (status) => {
  console.log('running:', status.running, 'dirs:', status.directories);
});

// Later
off();
```

## Configuration Helpers

The service exposes a handful of convenience methods that delegate to the underlying `ConfigStore`:

- `setConfig(next: Partial<IConfig>)`
- `setDryRun(value: boolean)`
- `setLaunchOnLogin(value: boolean)`
- `setWatchDirs(dirs: string[])`
- `addWatchDir(dir: string)` / `removeWatchDir(dir: string)`
- `setPrimaryWatchDir(dir: string)`

Each helper automatically normalizes directory paths (deduping, resolving to absolute paths) and triggers the watcher reconciliation flow when the service is running.

## Status Shape

`ServiceStatus` provides the minimum data required for UI layers to render state:

```ts
export type ServiceStatus = {
  running: boolean;
  directories: string[];
  dryRun: boolean;
  launchOnLogin: boolean;
};
```

When no directories are configured the service emits `running: false` with an empty `directories` array and logs a warning instead of throwing.

## File Events

`ServiceFileEvent` is a tagged union capturing the lifecycle of rename operations:

```ts
export type ServiceFileEvent =
  | { kind: 'preview'; file: string; target: string; directory: string; timestamp: number }
  | { kind: 'applied'; file: string; target: string; directory: string; timestamp: number }
  | { kind: 'skipped'; file: string; directory: string; timestamp: number; message?: string }
  | { kind: 'error'; file: string; directory: string; timestamp: number; message: string };
```

Front-ends should treat the payload as immutable data suitable for IPC serialization.

## Testing

`src/core/NamefixService.spec.ts` exercises the lifecycle behaviours (start/stop, watcher synchronization, file event emission) using in-memory stubs. Run the suite with:

```bash
npm run test
```

Type coverage is validated via:

```bash
npm run typecheck
```

## Next Steps for Integrators

- Use the exported types from `src/types/service.ts` in the Tauri bridge to guarantee IPC payload parity.
- Reuse the `IServiceEventStream` interface when exposing events to the frontend to keep subscription semantics identical across UIs.
- When extending the contract, update both the type map and this document to preserve a single source of truth.
