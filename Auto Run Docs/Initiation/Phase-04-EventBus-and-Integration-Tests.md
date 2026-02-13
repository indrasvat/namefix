# Phase 04: Event System Updates & Integration Tests

This phase ensures the new conversion events flow correctly through the entire EventBus system — from `NamefixService` through the service bridge to both the TUI and menu bar frontends. It also adds integration tests that verify the full pipeline: file detection → profile match → convert → trash → event emission.

## Tasks

- [x] Extend the internal `EventBus` with conversion-related events:
  - In `src/core/events/EventBus.ts`, add new event types to the `Events` map:
    ```typescript
    'file:converted': { from: string; to: string; format: string };
    'file:trashed': { path: string };
    ```
  - These internal events complement the service-level `ServiceFileEvent` kinds added in Phase 03
  - Update `NamefixService` to emit these EventBus events alongside the service emitter events:
    - After successful conversion: `this.eventBus.emit('file:converted', { from: srcPath, to: destPath, format: 'jpeg' })`
    - After successful trash: `this.eventBus.emit('file:trashed', { path: srcPath })`

- [x] Update the service bridge to forward conversion events to the Tauri frontend:
  - In `apps/menu-bar/src-tauri/resources/service-bridge.mjs`:
    - The bridge already forwards all `file` events via `service.on('file', ...)` — no changes needed there since conversion events are new `kind` values on the existing `ServiceFileEvent` type
    - Verify that the existing `forwardEvents()` function will correctly serialize the new `kind: 'converted'`, `kind: 'convert-error'`, and `kind: 'trashed'` events to the Tauri frontend (it should, since it forwards all `file` events generically)
    - If the bridge handler logic inspects `kind` values anywhere, update it to handle the new kinds gracefully
  - **Verified**: No code changes needed. The entire bridge pipeline is generic:
    - `service-bridge.mjs:81` forwards all `file` events without inspecting `kind`
    - `bridge.rs` reader (line 71-77) deserializes JSON as generic `serde_json::Value`, no payload inspection
    - `init_bridge` (line 241-244) emits to Tauri as `service://{name}` with payload passed through untouched
    - `NamefixService.ts` already emits `converted`, `convert-error`, and `trashed` kinds via the `ServiceEventMap` emitter

- [x] Create `src/core/convert/ConversionPipeline.spec.ts` — integration tests for the full conversion pipeline:
  - This spec tests the `NamefixService` end-to-end with mocked filesystem and conversion services
  - Setup:
    - Use `MemoryConfigStore` from existing `NamefixService.spec.ts` patterns (copy the helper class)
    - Create a mock `ConversionService` with `vi.fn()` methods
    - Create a mock `TrashService` with `vi.fn()` methods
    - Create a config with a HEIC conversion profile (`action: 'convert'`, pattern: `*.heic`)
  - Test: HEIC file triggers conversion pipeline:
    - Trigger a watch event for `IMG_1234.heic`
    - Verify `converter.canConvert('.heic')` was called
    - Verify `converter.convert()` was called with the correct source path and options
    - Verify `trasher.moveToTrash()` was called with the original HEIC path
    - Verify `file` event was emitted with `kind: 'converted'`
    - Verify `file` event was emitted with `kind: 'trashed'`
  - Test: Non-convertible file with convert action is skipped:
    - Configure `canConvert` to return `false` for `.mp4`
    - Trigger a watch event for `video.mp4`
    - Verify `converter.convert()` was NOT called
    - Verify `file` event was emitted with `kind: 'skipped'`
  - Test: Dry-run mode emits preview without converting:
    - Set `dryRun: true` in config
    - Trigger watch event for `IMG_1234.heic`
    - Verify `converter.convert()` was NOT called
    - Verify `file` event was emitted with `kind: 'preview'`
  - Test: Conversion failure emits error event:
    - Mock `converter.convert()` to throw
    - Trigger watch event for `IMG_1234.heic`
    - Verify `file` event was emitted with `kind: 'convert-error'`
  - Test: Trash failure after conversion emits toast warning:
    - Mock `trasher.moveToTrash()` to return `{ success: false, error: 'permission denied' }`
    - Trigger watch event for `IMG_1234.heic`
    - Verify `converted` event was still emitted (conversion succeeded)
    - Verify a `toast` event was emitted with `level: 'warn'`
  - Test: rename+convert action converts then renames:
    - Configure profile with `action: 'rename+convert'`
    - Trigger watch event for `IMG_1234.heic`
    - Verify conversion happens first, then the converted file is renamed per template

- [ ] Run all tests and verify the full suite:
  - Run `pnpm test -- src/core/convert/ConversionPipeline.spec.ts` to run the new integration tests
  - Run `make test` to verify all existing and new tests pass together
  - Run `make check` for the full quality pipeline (fmt + lint + typecheck + test)
