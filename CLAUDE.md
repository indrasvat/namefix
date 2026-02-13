# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**namefix** is a macOS-first screenshot renamer with three entry points sharing a common core:
- **CLI/TUI** — Interactive terminal dashboard built with `blessed`
- **Menu bar companion** — Tauri + Vite desktop tray app
- **Automation hooks** — launchd plist generation for login startup

Config: `~/Library/Application Support/namefix/config.json`
Logs: `~/Library/Logs/namefix/`

## Commands

**NOTE: ALWAYS use `make` targets instead of direct pnpm/cargo/tauri commands. If a useful target is missing, add its generic version and use that!**

```bash
# Make targets (preferred)
make check                   # fmt + lint + typecheck + test
make build                   # Build shared core and CLI
make build-app               # Build macOS menu bar app (Tauri)
make run-app                 # Build and run menu bar app (release)
make dev                     # Run CLI/TUI in dev mode
make dev-app                 # Run menu bar app in dev mode
make test                    # Run unit tests
make typecheck               # Type-check without emitting
make lint                    # Lint code
make fmt                     # Format code
make ci                      # Full CI pipeline
make clean                   # Remove build artifacts
make release                 # Run semantic-release dry-run
make stage-resources         # Stage resources for Tauri build
make help                    # Show all available targets

# Direct pnpm (only when make target unavailable)
pnpm install                 # Install dependencies
```

## Architecture

### Core Service Layer (`src/core/`)

```
NamefixService           # Central orchestrator - manages config, watchers, rename lifecycle
├── ConfigStore          # Persists settings to config.json, emits change events
├── WatchService         # Chokidar-based file watcher per directory (with health monitoring)
├── RenameService        # Generates target names, handles collisions
├── ConversionService    # Image format conversion via macOS sips (HEIC→JPEG etc.)
├── TrashService         # Move files to macOS Trash via Finder AppleScript
├── Matcher              # Picomatch-based include/exclude filtering
├── ProfileMatcher       # Profile-based pattern matching with priority support
├── NameTemplate         # Template variable system for customizable rename formats
├── JournalStore         # Undo history persistence
├── EventBus             # Internal pub/sub for cross-component events
└── FsSafe               # Atomic file operations
```

### Profiles System

Namefix uses configurable **profiles** for pattern-based renaming:

```typescript
interface IProfile {
  id: string;           // Unique ID (profile-{uuid})
  name: string;         // Display name
  enabled: boolean;     // Active/inactive
  pattern: string;      // Glob or regex pattern
  isRegex: boolean;     // Pattern type
  template: string;     // Output format template
  prefix: string;       // Prefix for <prefix> variable
  priority: number;     // Lower = matched first
  action?: 'rename' | 'convert' | 'rename+convert';  // Default: 'rename'
}
```

**Template variables**: `<date>`, `<time>`, `<datetime>`, `<original>`, `<ext>`, `<counter>`, `<prefix>`, `<year>`, `<month>`, `<day>`, `<hour>`, `<minute>`, `<second>`, `<upper:var>`, `<lower:var>`, `<slug:var>`

**Event-driven design**: `NamefixService` emits typed events (`ServiceEventMap`) consumed by both TUI and menu bar app.

### TUI Layer (`src/tui/`)

```
ScreenManager            # Blessed screen setup, coordinates views
├── HeaderView           # Title bar with dry-run indicator
├── EventListView        # Scrollable rename event log
├── FooterView           # Keybinding hints
├── SettingsModalView    # Settings dialog
├── ToastView            # Transient notifications
└── ThemeManager         # Theme switching
```

### Entry Points

- `bin/namefix.js` — CLI entrypoint, loads `dist/cli/index.js`
- `src/cli/index.ts` — Commander-based argument parsing, creates `NamefixApp`
- `src/core/App.ts` — `NamefixApp` wires service to TUI, handles keybindings

### Menu Bar App (`apps/menu-bar/`)

Tauri app with Vite frontend. Communicates with the core service via Tauri commands. Build output: `src-tauri/target/release/bundle/macos/`

## Key Patterns

### TypeScript Path Aliases

```typescript
import { ConfigStore } from '@core/config/ConfigStore.js';
import { HeaderView } from '@tui/components/HeaderView.js';
```

Mapped in `tsconfig.json`: `@core/*`, `@tui/*`, `@types/*`, `@utils/*`

### Service Events

```typescript
service.on('file', (event) => { /* preview | applied | skipped | error | converted | convert-error | trashed */ });
service.on('status', (status) => { /* running, directories, dryRun */ });
service.on('config', (cfg) => { /* config changed */ });
service.on('toast', ({ message, level }) => { /* notifications */ });
```

### Testing

- Specs alongside sources as `*.spec.ts`
- Framework: Vitest
- Run single test: `pnpm test -- src/core/NamefixService.spec.ts`

## Code Style

- **Formatter**: Biome (100 char line width, single quotes)
- **Naming**: PascalCase classes, camelCase functions/variables, kebab-case files
- **Commits**: Brief, one-liner conventional commits (`fix(menu-bar): description`)
- **Volta pins**: Node 22.14.0, pnpm 9

## Releases

Automated via semantic-release on push to `main`. Do not create tags manually.

## macOS Notes

Unsigned builds require clearing quarantine:
```bash
xattr -cr "/Applications/Namefix Menu Bar.app"
```
