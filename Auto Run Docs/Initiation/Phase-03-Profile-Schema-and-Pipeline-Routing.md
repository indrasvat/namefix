# Phase 03: Profile Schema Extension & Pipeline Routing

This phase extends the profile system with an `action` field so profiles can specify whether to rename, convert, or do both. The `NamefixService` pipeline is updated to route matched files through the appropriate action. The `ConfigStore` gets migration logic for the new field, and default profiles are updated. This is the architectural heart of the feature — it wires the new services into the existing event-driven pipeline.

## Tasks

- [x] Extend `IProfile` with the `action` field and update related types:
  - In `src/types/index.ts`, add to `IProfile`:
    ```typescript
    /** Action to perform on matched files: rename (default), convert, or both */
    action?: 'rename' | 'convert' | 'rename+convert';
    ```
  - The field is optional with `'rename'` as the implicit default — this preserves backward compatibility with existing configs that don't have the field
  - In `src/types/service.ts`, extend `ServiceFileEvent` with new conversion event kinds:
    ```typescript
    | { kind: 'converted'; file: string; target: string; directory: string; timestamp: number; format: string }
    | { kind: 'convert-error'; file: string; directory: string; timestamp: number; message: string }
    | { kind: 'trashed'; file: string; directory: string; timestamp: number }
    ```
  - These new event kinds flow through the existing `ServiceEventMap` `file` channel — no new event keys needed, just new `kind` values on `ServiceFileEvent`

- [x] Update `ConfigStore` to handle the new `action` field:
  - In `src/core/config/ConfigStore.ts`:
    - Update `isValidProfile()` — the `action` field is optional, but if present must be one of `'rename' | 'convert' | 'rename+convert'`
    - No migration needed for existing profiles — missing `action` field defaults to `'rename'` behavior
  - In `src/core/rename/NameTemplate.ts`:
    - Add a new default profile for HEIC conversion to `DEFAULT_PROFILES`:
      ```typescript
      {
        id: 'heic-convert',
        name: 'HEIC to JPEG',
        enabled: true,
        pattern: '*.heic',
        isRegex: false,
        template: '<original>',
        prefix: '',
        priority: 0,  // Higher priority than screenshots (lower number = first)
        action: 'convert',
      }
      ```
    - This profile catches `.heic` files before the Screenshot profile, converts them to JPEG, keeps the original name, and does NOT rename
    - Update `DEFAULT_PROFILES` type to include the `action` field (it should satisfy `IProfile`)

- [x] Update `NamefixService` to route files through conversion, rename, or both:
  - In `src/core/NamefixService.ts`:
    - Add `ConversionService` and `TrashService` as constructor dependencies (with defaults like existing services):
      ```typescript
      private converter: ConversionService;
      private trasher: TrashService;
      ```
    - Import from `'./convert/ConversionService.js'` and `'./convert/TrashService.js'`
    - Update the constructor deps type to accept optional `converter` and `trasher`
    - Modify `handleProfileRename()` to check `profile.action`:
      - `'rename'` (or undefined/missing): existing behavior — rename only
      - `'convert'`: call `ConversionService.convert()`, then `TrashService.moveToTrash()` on the original, emit `converted` and `trashed` events
      - `'rename+convert'`: convert first, then rename the converted output, trash the original
    - For `'convert'` action:
      1. Check `converter.canConvert(ext)` — if false, skip with a `skipped` event (message: `unsupported format`)
      2. If `dryRun`, emit a `preview` event showing `file.heic → file.jpeg` and return
      3. Call `converter.convert(srcPath, { outputFormat: 'jpeg' })` — JPEG is the default output format for now
      4. On success: emit `{ kind: 'converted', file: basename, target: convertedBasename, directory, timestamp, format: 'jpeg' }`
      5. Move original to Trash: call `trasher.moveToTrash(srcPath)`
      6. On trash success: emit `{ kind: 'trashed', file: basename, directory, timestamp }`
      7. On trash failure: emit a toast warning (non-fatal — the conversion succeeded)
      8. On conversion failure: emit `{ kind: 'convert-error', file: basename, directory, timestamp, message }`
    - For `'rename+convert'` action:
      1. Convert first (same as above steps 1-4)
      2. Then rename the converted file using the existing `handleProfileRename` logic, but operating on the converted output path
      3. Trash the original
    - Journal: record both the conversion and any rename so undo can reverse both operations

- [x] Update existing tests and add new tests for the profile schema changes:
  - In `src/core/config/ConfigStore.spec.ts`:
    - Add a test that configs without `action` field load correctly (backward compat)
    - Add a test that configs with valid `action` values (`'rename'`, `'convert'`, `'rename+convert'`) are accepted
    - Add a test that the new `'heic-convert'` default profile is present in fresh configs
  - In `src/core/NamefixService.spec.ts`:
    - Add `converter` and `trasher` mocks to the `createService()` helper:
      ```typescript
      const mockConverter = { convert: vi.fn(), canConvert: vi.fn() };
      const mockTrasher = { moveToTrash: vi.fn() };
      ```
    - Add test: profile with `action: 'convert'` triggers conversion (not rename)
    - Add test: profile with `action: 'convert'` in dry-run emits preview event
    - Add test: profile with `action: 'rename'` (or missing action) triggers rename only (existing behavior preserved)
    - Add test: conversion failure emits `convert-error` event
    - Add test: trash failure after conversion emits toast warning but conversion event still fires

- [x] Run all tests and quality checks:
  - Run `make test` — all existing and new tests must pass
  - Run `make typecheck` — no type errors
  - Run `make lint` — no lint errors
  - Run `make check` to run the full quality pipeline
