# Phase 01: Environment Setup & Verification

This phase ensures the development environment is fully operational before any feature work begins. We install dependencies, build the project, run existing tests, and launch the CLI binary so macOS can prompt for any filesystem permissions upfront. By the end, you'll have a green test suite and a confirmed-working binary — no permission dialogs will interrupt later phases.

## Tasks

- [x] Install dependencies and verify the build toolchain:
  - Run `pnpm install` to install all workspace dependencies
  - Run `make build` to compile the TypeScript core and CLI
  - Verify `dist/` output was created successfully (check `dist/core/NamefixService.js` exists)
  - Run `make typecheck` to confirm no type errors in the current codebase
  > **Completed**: pnpm install added 358 packages, `make build` compiled successfully, `dist/core/NamefixService.js` confirmed present, `make typecheck` passed with zero errors. Note: Node v24.13.0 is above the engine range (>=20 <23) — runs fine but emits a WARN.

- [x] Run the existing test suite to establish a green baseline:
  - Run `make test` and verify all tests pass
  - Note the current test count for later comparison (specs: `ConfigStore.spec.ts`, `NamefixService.spec.ts`, `RenameService.spec.ts`, `paths.spec.ts`)
  - If any tests fail, investigate and fix before proceeding (the codebase should be in a clean state on `main`)
  > **Completed**: All 11 tests pass across 4 spec files — `paths.spec.ts` (2), `RenameService.spec.ts` (2), `ConfigStore.spec.ts` (3), `NamefixService.spec.ts` (4). Vitest v2.1.9, total duration 765ms. Green baseline established.

- [x] Launch the CLI binary to trigger macOS permission prompts:
  - Run `node bin/namefix.js --help` to verify the binary loads without errors
  - Run `node bin/namefix.js --dry-run --watch-dir ~/Downloads` in the background for ~5 seconds to trigger any macOS file access permission dialogs, then kill the process
  - This step is critical: macOS will prompt for access to `~/Downloads` (and potentially other directories) — getting this out of the way now prevents permission dialogs from blocking automated execution in later phases
  - Verify the config directory was created at `~/Library/Application Support/namefix/`
  > **Completed**: `--help` output confirmed (all options listed, no errors). CLI ran in dry-run mode watching `~/Downloads` for 5 seconds — TUI initialized successfully and process was cleanly terminated. Config directory confirmed at `~/Library/Application Support/namefix/config.json` (795 bytes) with default profiles (Screenshots, Screen Recordings) and watch directories (Downloads, Desktop).

- [ ] Run the full quality check to confirm everything is clean:
  - Run `make check` (which runs `fmt + lint + typecheck + test`)
  - All four steps must pass — this is the baseline we'll maintain throughout all phases
  - If `make fmt` makes changes, that's fine (it auto-fixes), just confirm the subsequent steps still pass
