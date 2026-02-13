# Phase 05: TUI Updates

This phase updates the terminal UI layer to display conversion events and expose the new `action` field in profile settings. The TUI consumes events from `NamefixService` — no business logic lives in the UI layer. All changes are in `src/tui/` and `src/core/App.ts`.

## Tasks

- [x] Update `EventListView` to display conversion events:
  - In `src/tui/components/EventListView.ts`:
    - Update `UiEventItem.status` type to include new statuses: `'converted' | 'convert-error' | 'trashed'`
      ```typescript
      status: 'preview' | 'applied' | 'skipped' | 'error' | 'converted' | 'convert-error' | 'trashed';
      ```
    - Update `formatItem()` to assign colors for the new statuses:
      - `'converted'` → `'cyan'` (visually distinct from rename's `'green'`)
      - `'convert-error'` → `'red'` (same as existing error)
      - `'trashed'` → `'gray'` (informational, low-priority)
    - These are display-only changes — the component already receives items via `addItem()` and formats them generically

- [x] Update `App.ts` to map conversion service events to TUI events:
  - In `src/core/App.ts`, update the `bindServiceEvents()` method's `file` event handler:
    - The handler currently checks for `event.kind === 'preview' || 'applied'` and `'skipped'` / `'error'`
    - Add handling for the new event kinds:
      ```typescript
      if (event.kind === 'converted') {
        ui.addEvent({
          when,
          file: `${event.file}${directoryHint}`,
          target: event.target,
          status: 'converted',
        });
      } else if (event.kind === 'convert-error') {
        ui.addEvent({
          when,
          file: `${event.file}${directoryHint}`,
          status: 'convert-error',
          message: event.message,
        });
      } else if (event.kind === 'trashed') {
        ui.addEvent({
          when,
          file: `${event.file}${directoryHint}`,
          status: 'trashed',
        });
      }
      ```
    - This maintains the existing pattern: `App.ts` maps service events to UI events, no business logic

- [x] Update `FooterView` to show conversion action hint:
  - In `src/tui/components/FooterView.ts`:
    - If there isn't already a key hint line, no changes needed — the footer shows keybindings
    - The existing keybinding hints (`d` for dry-run, `u` for undo, `s` for settings) remain unchanged
    - No new keybindings are needed for conversion — it's automatic based on profile config

- [ ] Run tests and quality checks:
  - Run `make test` — all tests must pass
  - Run `make typecheck` — the new event kind types must compile cleanly
  - Run `make check` for the full quality pipeline
  - Manually verify (if possible) by running `make dev` and checking that the TUI renders without errors — though this is best verified in Phase 07's end-to-end validation
