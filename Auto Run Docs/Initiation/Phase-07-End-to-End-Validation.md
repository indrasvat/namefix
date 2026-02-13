# Phase 07: End-to-End Validation

This phase is the final quality gate. It runs the full test suite, performs a real HEIC conversion smoke test, builds both the CLI and menu bar app, and verifies everything works together. By the end, the HEIC auto-conversion feature is production-ready.

## Tasks

- [x] Run the complete test suite and quality pipeline:
  - Run `make check` (fmt + lint + typecheck + test) — all must pass
  - Verify the test count has increased from Phase 01's baseline:
    - Original specs: `ConfigStore.spec.ts`, `NamefixService.spec.ts`, `RenameService.spec.ts`, `paths.spec.ts`
    - New specs: `ConversionService.spec.ts`, `TrashService.spec.ts`, `ConversionPipeline.spec.ts`
    - All 7 spec files should be discovered and run
  - If any test fails, fix it before proceeding
  - ✅ **Completed**: `make check` passed — fmt, lint, typecheck, and all 38 tests across 7 spec files pass green.

- [x] Perform a real HEIC→JPEG conversion smoke test:
  - Create a temporary test directory: `mkdir -p /tmp/namefix-smoke-test`
  - Verify `sips` is available: `which sips` (should be at `/usr/bin/sips`)
  - Create a test HEIC file if one is available, OR test with a PNG-to-JPEG conversion as a proxy:
    - `sips --setProperty format jpeg --setProperty formatOptions 90 /tmp/namefix-smoke-test/test.png --out /tmp/namefix-smoke-test/test.jpeg`
    - This verifies the `sips` command structure works correctly on this machine
  - If a real `.heic` file is available in `~/Downloads`, copy it to the temp dir and test conversion
  - Verify the output file exists and has a non-zero size
  - Clean up: `rm -rf /tmp/namefix-smoke-test`
  - ✅ **Completed**: `sips` confirmed at `/usr/bin/sips`. PNG→JPEG proxy conversion succeeded (931 bytes valid JPEG output). No real HEIC files found on disk. Temp directory cleaned up.

- [ ] Build the CLI and verify the new default profile appears:
  - Run `make build` to compile the TypeScript core
  - Run `node bin/namefix.js --help` to verify the CLI still loads
  - Temporarily start the service to verify the HEIC conversion profile is in the default config:
    - Start with dry-run: `timeout 5 node bin/namefix.js --dry-run --watch-dir /tmp/namefix-smoke-test 2>&1 || true`
    - Check the config file at `~/Library/Application Support/namefix/config.json`
    - Verify it contains a profile with `"id": "heic-convert"` and `"action": "convert"` and `"pattern": "*.heic"`
    - If the config already existed from Phase 01, the new default profile should have been added via the migration logic

- [ ] Build the menu bar app (if the Tauri toolchain is available):
  - Check if Cargo and Tauri CLI are available: `which cargo` and verify the Tauri project compiles
  - If available: run `make build-app` to build the full macOS menu bar app
  - If NOT available (missing Rust toolchain): skip this step — the core TypeScript changes are independently verified by the test suite, and the Tauri build can be done separately
  - Verify no Rust compilation errors from the updated `bridge.rs` Profile struct

- [ ] Final verification — run the full CI pipeline:
  - Run `make ci` (which runs `check + build`)
  - All steps must pass green
  - This is the same pipeline that runs in GitHub Actions — if it passes locally, it will pass in CI
  - Summarize the changes made:
    - New files created (list all new `.ts` and `.spec.ts` files)
    - Files modified (list all changed files)
    - New profile: `heic-convert` default profile
    - New types: `ConvertOptions`, `ConvertResult`, `TrashResult`, `ServiceFileEvent` new kinds
    - New services: `ConversionService`, `TrashService`
    - Architecture: no new dependencies, uses macOS built-in `sips` and `osascript`
