# namefix

Namefix is a macOS-first screenshot renamer that keeps your desktop tidy. It ships three coordinated entry points that all share the same core service:

- **CLI / TUI** — an interactive terminal dashboard for power users.
- **Menu bar companion** — a tray app with live status, start/stop, undo, and directory management.
- **Automation hooks** — launchd plist generation so you can run the watcher at login.

The service watches one or more folders (Desktop by default), renames new screenshots using your preferred prefix (defaults to `Screenshot`), and persists its settings on disk so every surface stays in sync.

---

## Requirements

| Component | Requirements |
|-----------|--------------|
| CLI / TUI | macOS, Node.js ≥ 20, `npm` |
| Menu bar (dev) | CLI requirements + Rust toolchain + Xcode command line tools |
| Menu bar (packaged build) | macOS host (GitHub runner or local) with the above toolchain |

The project currently targets macOS. Linux paths follow the XDG directory conventions but are not yet tested.

---

## Repository tour

```
apps/menu-bar/      # Tauri + Vite menu bar front-end
src/                # Shared service, CLI, TUI implementation
scripts/            # Helper scripts (set-version, release automation)
.github/workflows/  # CI/CD (semantic-release packaging)
```

Config lives in `~/Library/Application Support/namefix/config.json` (or the XDG equivalent). Logs land in `~/Library/Logs/namefix/`.

---

## Getting started

### 1. Install dependencies

```bash
npm ci
npm --prefix apps/menu-bar ci   # menu bar dependencies (optional unless you build the tray app)
```

### 2. Build the shared service

```bash
npm run build
```

This compiles the shared service/CLI and produces distributables under `dist/cli`.

---

## CLI / TUI usage

After building, `bin/namefix.js` is available on your PATH.

```bash
# interactive terminal UI (defaults to ~/Desktop, dry-run mode)
namefix

# flag examples
namefix --watch ~/Screenshots --live             # start live instead of dry-run
namefix --prefix "Capture" --include "Capture*"  # customise naming + filters
namefix --print-launchd                          # emit launchd plist for automation
namefix --version
```

| Flag | Description |
|------|-------------|
| `-w, --watch <dir>` | Override primary watch directory for this session. |
| `--dry-run` | Force dry-run mode (never rename, just preview). |
| `--live` | Force live mode (apply renames). |
| `--prefix <prefix>` | Prefix for generated names (`Screenshot` by default). |
| `--include <glob...>` | Glob patterns that must match to trigger a rename. |
| `--exclude <glob...>` | Glob patterns to ignore. |
| `--theme <name>` | TUI theme selection (defaults to `default`). |
| `--print-launchd` | Print a launchd plist to stdout. |
| `--version` | Output current version. |

The TUI mirrors these controls (start/stop, dry-run, undo, directory management).

---

## Menu bar companion

### Development

```bash
npm run menubar
```

This builds the shared service, starts Vite, and launches Tauri. The tray icon exposes Pause/Start, Dry Run, Launch on Login, Undo Last Rename, Preferences…, and Quit.

### Preferences window

The Preferences window shows an Overview tab (metrics, controls, undo, live status) and a Directories tab for managing watch folders. Changes propagate instantly to the CLI and tray menu.

### Building a distributable

```bash
npm run build
npm --prefix apps/menu-bar run tauri:build
```

Outputs appear under `apps/menu-bar/src-tauri/target/release/bundle/macos/`:

- `.app` bundle (zip before sharing) and `.dmg` disk image.
- Builds are unsigned; right-click → “Open” on first launch. Add signing credentials to the workflow if you need notarisation.

---

## Settings & persistence

| Setting | Surfaces | Notes |
|---------|----------|-------|
| Watch directories (`watchDirs`) | Preferences window, TUI | Stored in `config.json`; first entry is primary. |
| Dry run / live | Tray toggle, TUI, CLI flags | Defaults to dry-run to keep first runs safe. |
| Launch on login | Tray toggle | Uses Tauri autostart plugin on macOS (login items). |
| Prefix / include / exclude | CLI flags today | Persisted in config; UI exposure planned. |
| Undo history | Tray undo, TUI | Journal stored alongside config. |

---

## Release workflow

Releases are automated via [semantic-release](https://semantic-release.gitbook.io/semantic-release/). Push (or merge) to `main` using [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) messages and the `Release` workflow will:

1. Determine the next semantic version.
2. Update `package.json`, `apps/menu-bar/package.json`, both lockfiles, the Tauri config, and `CHANGELOG.md`.
3. Build the CLI and the Tauri bundle, packaging unsigned `.app.zip` and `.dmg` artifacts.
4. Publish a GitHub release with those artifacts and the generated changelog, pushing the version bump + tag back to `main`.

Local dry-run (requires a GitHub token with `repo` scope):

```bash
GITHUB_TOKEN=<token> npm run release
```

---

## Development scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile the shared TypeScript sources (CLI/TUI). |
| `npm run typecheck` | Type-only check with `tsc --noEmit`. |
| `npm run menubar` | Start the Tauri dev server with Vite. |
| `npm --prefix apps/menu-bar run tauri:build` | Produce release bundles locally. |
| `npm run test` | Run Vitest suite. |
| `npm run release` | Run semantic-release locally (requires `GITHUB_TOKEN`). |
| `npm run biome` / `npm run format` / `npm run lint` | Biome code-quality tooling. |

---

## Known limitations

- Menu bar bundles are currently unsigned; users must right-click → “Open” the first time. Add signing creds in CI for notarised builds.
- A rare double-rename is still under investigation; restarting the watcher clears it for now.

---

## License

MIT © the namefix contributors.
