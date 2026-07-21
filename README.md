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
| CLI / TUI | macOS, Node.js ≥ 20, `pnpm` ≥ 9 |
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

## Releases

Semantic Release runs on every push to `main`, evaluates conventional commits, and publishes the next `v*` tag plus macOS artifacts automatically. Avoid creating git tags by hand—let the workflow own versioning.

---

## Getting started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Build the shared service

```bash
pnpm run build
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
pnpm run menubar
```

This builds the shared service, starts Vite, and launches Tauri. The tray icon exposes Pause/Start, Dry Run, Launch on Login, Undo Last Rename, Preferences…, and Quit.

### Preferences window

The Preferences window shows an Overview tab (metrics, controls, undo, live status) and a Directories tab for managing watch folders. Changes propagate instantly to the CLI and tray menu.

### Building a distributable

```bash
pnpm run build
pnpm --filter @namefix/menu-bar run tauri:build
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

Releases are automated via [semantic-release](https://semantic-release.gitbook.io/semantic-release/). Push (or merge) to `main` using [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) messages and the release job will run after CI succeeds:

1. Determine the next semantic version.
2. Update both `package.json` files, the Tauri and Cargo manifests, `Cargo.lock`, and `CHANGELOG.md`.
3. Verify that every Node and Tauri/Cargo version source agrees.
4. Build the CLI and the Tauri bundle, packaging unsigned `.app.zip` and `.dmg` artifacts.
5. Push the synchronized release commit and tag to `main`, then publish a GitHub release with the artifacts and generated notes.

Local dry-run (requires a GitHub token with `repo` scope):

```bash
GITHUB_TOKEN=<token> make release
```

---

## Development scripts

| Command | Description |
|---------|-------------|
| `make build` | Compile the shared TypeScript sources (CLI/TUI). |
| `make typecheck` | Type-only check with `tsc --noEmit`. |
| `make dev-app` | Start the Tauri development app. |
| `make build-app` | Produce release bundles locally. |
| `make test` | Run the Vitest suite. |
| `make test-coverage` | Run Vitest with the 85% coverage gate. |
| `make version-check` | Verify that Node, Tauri, and Cargo versions agree. |
| `make release` | Run a semantic-release dry-run (requires `GITHUB_TOKEN`). |
| `make fmt` / `make lint` | Run Biome formatting or linting. |

---

## Test coverage

CI runs `pnpm run test:coverage` for the Linux-testable shared service surface: `src/core`, `src/utils`, and `src/integrations`. TUI rendering, packaging scripts, generated build output, and native Tauri shell code are excluded from the Vitest gate because they require visual or macOS-specific coverage paths.

Current coverage from the local gate:

| Metric | Coverage |
|--------|----------|
| Statements | 88.88% |
| Branches | 86.89% |
| Functions | 97.43% |
| Lines | 88.88% |

---

## Known limitations

- **Unsigned Builds:** The menu bar app is currently unsigned. On first launch, macOS may report the app as "damaged". Run the following command to clear the quarantine attribute:
  ```bash
  xattr -cr "/Applications/Namefix Menu Bar.app"
  ```
  Then launch the app as normal.

---

## License

MIT © the namefix contributors.
