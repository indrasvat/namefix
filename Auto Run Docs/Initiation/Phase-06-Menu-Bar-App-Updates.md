# Phase 06: Menu Bar App Updates

This phase updates the Tauri menu bar frontend to expose the new `action` field in the profile editor, display conversion events in the UI, and update the Rust bridge types to support the new profile field. The menu bar app communicates with the core service via a Node.js sidecar bridge — all business logic stays in the core, the frontend only renders and sends user input.

## Tasks

- [x] Update the Rust bridge types and service bridge to support the `action` field:
  - In `apps/menu-bar/src-tauri/src/bridge.rs`:
    - Add `action` field to the `Profile` struct:
      ```rust
      #[serde(skip_serializing_if = "Option::is_none")]
      pub action: Option<String>,  // "rename" | "convert" | "rename+convert"
      ```
    - No changes needed to bridge functions — `set_profile` and `get_profiles` already serialize/deserialize the full `Profile` object. The `action` field will pass through as JSON naturally.
  - In `apps/menu-bar/src-tauri/resources/service-bridge.mjs`:
    - Verify no changes are needed — the bridge forwards profile objects between Tauri and `NamefixService` generically via JSON-RPC. The new `action` field should pass through without code changes. If the `setProfile` handler destructures specific fields, update it to include `action`.

- [ ] Add the `action` field to the profile editor modal in the HTML:
  - In `apps/menu-bar/index.html`:
    - Add a new form group for the Action selector between the Priority and Preview sections:
      ```html
      <div class="form-group">
        <label for="profile-action">Action</label>
        <select id="profile-action">
          <option value="rename">Rename only</option>
          <option value="convert">Convert format</option>
          <option value="rename+convert">Convert + Rename</option>
        </select>
        <div class="form-hint">What to do when a file matches this profile</div>
      </div>
      ```
    - Add CSS for the `<select>` element, matching the existing input styling:
      ```css
      .form-group select {
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(10, 12, 24, 0.3);
        color: inherit;
        font-size: 0.88rem;
        font-family: inherit;
        cursor: pointer;
      }
      .form-group select:focus {
        border-color: var(--accent);
        outline: none;
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
      }
      ```
    - Update the Profiles tab header text from "Rename Profiles" to "Profiles" and subtitle from "Rules that determine how files are renamed" to "Rules that determine how matched files are processed"

- [ ] Update the menu bar TypeScript to handle the `action` field:
  - In `apps/menu-bar/src/main.ts`:
    - Add `action` to the `Profile` type:
      ```typescript
      action?: 'rename' | 'convert' | 'rename+convert';
      ```
    - Query the new DOM element:
      ```typescript
      const profileActionSelect = document.querySelector<HTMLSelectElement>('#profile-action');
      ```
    - In `openProfileModal()`: set the select value from the profile's action (default to `'rename'`)
    - In `saveProfile()`: read `profileActionSelect?.value` and include it in the profile object sent to the backend
    - In `renderProfiles()`: update the profile rule display to show the action type. Use safe DOM construction methods (createElement, textContent, appendChild) — do NOT use innerHTML with dynamic data. Create a small `<span>` tag with class `action-tag` and textContent set to the action name, prepended before the pattern text, for profiles where action is not the default `'rename'`.
    - NOTE: The existing codebase uses innerHTML in `renderProfiles()` for profile rules. When modifying this function, refactor the rule rendering to use safe DOM methods (createElement, textContent) instead. This prevents XSS from potentially malicious profile names/patterns.
    - Add CSS for the action tag:
      ```css
      .action-tag {
        font-size: 0.65rem;
        padding: 1px 5px;
        border-radius: 3px;
        background: rgba(56, 189, 248, 0.15);
        color: var(--accent);
        font-weight: 600;
        margin-right: 4px;
      }
      ```
    - Update `updatePreview()` to show conversion preview when action is `'convert'` — the preview should show the format change (e.g., `IMG_1234.heic → IMG_1234.jpeg`) instead of renaming

- [ ] Update the Tauri frontend to display conversion file events:
  - The frontend currently listens for `service://file` events but doesn't render them in a log (the TUI has EventListView, the menu bar doesn't currently have an event log)
  - No changes needed here unless there is already a file event display section — verify by checking the HTML
  - The toast system already handles `service://toast` events which will show conversion success/failure messages
  - If there IS a file event section, add styling for `converted` (cyan accent), `convert-error` (red), and `trashed` (gray) event kinds

- [ ] Run quality checks on the menu bar app:
  - Run `make typecheck` — verify no TS errors in the menu bar source
  - Run `make lint` to verify code style
  - Run `make build` to ensure the TypeScript core compiles (the menu bar frontend builds via Vite when needed)
  - Run `make test` to verify no regressions
  - Run `make check` for the full pipeline
