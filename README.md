# Namefix

Namefix is a macOS-first screenshot renamer that keeps your desktop tidy.  
It ships three coordinated entry points that all share the same core service:

- **CLI / TUI** &mdash; an interactive terminal dashboard for power users.
- **Menu bar companion** &mdash; a tray app with live status, start/stop, undo, and directory management.
- **Automation hooks** &mdash; launchd plist generation so you can run the watcher at login.

The service watches one or more folders (Desktop by default), renames new screenshots using
your preferred prefix (defaults to `Screenshot`), and persists its settings on disk so every surface
stays in sync.

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
scripts/            # Helper scripts (set-version, release utilities)
.github/workflows/  # CI/CD (packaging + release)
```

Configuration lives in `~/Library/Application Support/namefix/config.json`
(or the XDG equivalent). Logs are written to `~/Library/Logs/namefix/`.

---

## Getting started

### 1. Install dependencies

```bash
npm ci
npm --prefix apps/menu-bar ci   # menu bar dependencies (optional unless you build the tray app)
```

### 2. Build the shared service

```bash
npm run build      # compiles the TypeScript core + CLI
```

This produces the distributable CLI/TUI under `dist/cli`.

---

## Using the CLI / TUI

After running `npm run build`, the `namefix` binary is available on your `PATH`
via `bin/namefix.js`.

```bash
# launch the interactive terminal UI (defaults to ~/Desktop, dry-run mode)
namefix

# common flags
namefix --watch ~/Screenshots --live             # start live without dry-run
namefix --prefix "Capture" --include "Capture*"  # customise naming + filters
namefix --print-launchd                          # emit launchd plist for automation
namefix --version
```

All CLI options:

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

The TUI exposes the same controls interactively (start/stop, dry-run toggle, directory list, undo).

---

## Running the menu bar companion

### Development (hot reload)

```bash
npm run menubar
```

This builds the shared service, spins up Vite, and launches Tauri in dev mode.
A tray icon labelled **Namefix** appears with the following menu items:

- **Pause/Start Watching** &mdash; toggles the watcher service.
- **Dry Run** &mdash; preview renames without mutating files.
- **Launch on Login** &mdash; enables autostart.
- **Undo Last Rename** &mdash; reverts the most recent rename (keeps a short journal).
- **Preferences…** &mdash; opens the HTML control centre (watch directories, status).
- **Quit Namefix**.

The Preferences window mirrors the CLI controls: metrics, toggles, undo, and directory CRUD.

### Building a distributable app

```bash
npm run build                              # ensure the core is compiled
npm --prefix apps/menu-bar run tauri:build # produces macOS bundles under apps/menu-bar/src-tauri/target/release/bundle
```

Outputs include:

- `*.app` &mdash; the unsigned app bundle (zip it before distribution).
- `*.dmg` &mdash; unsigned disk image you can share with testers.

> **Note:** The artifacts are unsigned. On first launch macOS will require
> right-click → “Open” to bypass Gatekeeper.

---

## Settings & persistence

| Setting | Surfaces | Notes |
|---------|----------|-------|
| Watch directories (`watchDirs`) | Preferences window, TUI | Stored in `config.json`; first entry is primary. |
| Dry run / live | Tray toggle, TUI, CLI flags | Defaults to dry-run to protect your files on first run. |
| Launch on login | Tray toggle | Uses Tauri’s autostart plugin on macOS (login items). |
| Rename prefix / globs | CLI flags today | Planned UI surface later; persists in config. |
| Undo history | Tray `Undo Last Rename`, TUI shortcuts | Journal stored in `~/Library/Application Support/namefix`. |

Change a setting in any surface and it will broadcast to the others immediately.

---

## Release workflow

Releases are automated through [semantic-release](https://semantic-release.gitbook.io/semantic-release/).
Push (or merge) to the `main` branch with [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) messages and the `Release` workflow will:

1. Determine the next semantic version based on commit history.
2. Update `package.json`, `apps/menu-bar/package.json`, the Tauri config, both lockfiles, and `CHANGELOG.md` via `scripts/set-version.mjs` and semantic-release plugins.
3. Build the CLI and the Tauri bundle, packaging the `.app` and `.dmg` artifacts.
4. Publish a GitHub release with the generated changelog and downloadable artifacts, then push the version bump back to `main` (tag + changelog commit).

To cut a release:

```bash
# ensure commits into main follow Conventional Commit syntax, e.g.
git commit -m "feat: add menubar directory picker"

# once merged into main the CI workflow handles versioning, tagging, and publishing.
```

If you prefer to trigger a release manually (for example when testing), you can run:

```bash
npm run release
```

and provide a `GITHUB_TOKEN` with `contents:write` permissions in your environment.

> **Signed builds:** artifacts are unsigned by default. Extend `.github/workflows/release.yml`
> with your signing/notarisation credentials (`TAURI_SIGNING_PRIVATE_KEY`, etc.) to produce
> notarised builds.

---

## Development scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile the shared TypeScript sources (CLI/TUI). |
| `npm run typecheck` | Type-only check with `tsc --noEmit`. |
| `npm run menubar` | Start the Tauri dev server with Vite. |
| `npm --prefix apps/menu-bar run tauri:build` | Produce release bundles locally. |
| `npm run test` | Run the current Vitest suite. |
| `npm run release` | Run semantic-release locally (requires `GITHUB_TOKEN`). |
| `npm run biome` / `npm run format` / `npm run lint` | Code quality tooling (Biome). |

---

## Known limitations

- Menu bar builds generated in CI are **unsigned**. Users must right-click → “Open”
  the first time they launch the app.
- The screenshot renamer still under active development. If you see duplicate rename attempts
  (files ending in `_2`), restart the watcher; we’re tracking that edge case in upcoming work.

---

## License

MIT © the namefix contributors.
