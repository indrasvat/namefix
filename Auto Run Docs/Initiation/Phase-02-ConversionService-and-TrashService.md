# Phase 02: ConversionService & TrashService

This phase creates the two new standalone core services that power the HEIC-to-JPEG conversion feature. `ConversionService` wraps the macOS built-in `sips` tool for image format conversion, and `TrashService` safely moves files to the macOS Trash (not permanent delete). Both follow the existing service patterns: pure TypeScript classes with dependency injection, no UI coupling, and companion spec files.

## Tasks

- [x] Create `src/core/convert/ConversionService.ts` — the sips-based image converter:
  - Create the `src/core/convert/` directory
  - The service should expose:
    - `convert(srcPath: string, opts: ConvertOptions): Promise<ConvertResult>` — converts a file (e.g., HEIC→JPEG) using `sips`
    - `canConvert(ext: string): boolean` — returns true if the extension is a supported input format
  - Define types:
    ```typescript
    export type ConvertOptions = {
      outputFormat: 'jpeg' | 'png' | 'tiff' | 'heic';
      outputDir?: string;    // defaults to same directory as source
      quality?: number;       // 0-100, default 90 (only for JPEG)
    };
    export type ConvertResult = {
      srcPath: string;
      destPath: string;
      format: string;
      durationMs: number;
    };
    ```
  - Supported input formats: `.heic`, `.heif`, `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp`, `.gif`
  - Use Node.js `node:child_process` `execFile` (promisified via `util.promisify`) to call:
    `sips --setProperty format <format> --setProperty formatOptions <quality> <srcPath> --out <destPath>`
    Using `execFile` (not `exec`) is critical — it avoids shell interpolation, preventing command injection. Do NOT use `exec` or shell strings.
  - The output path should be: same directory as source, same basename, but with the target format extension (e.g., `IMG_1234.heic` → `IMG_1234.jpeg`)
  - Handle collision: if the output path already exists, append `_2`, `_3`, etc. (same pattern as `RenameService.reserveTarget`)
  - If `sips` exits with non-zero code, throw an error with the stderr output
  - Export everything from `src/core/convert/ConversionService.ts`
  - Follow existing code style: Biome formatting, 100-char line width, single quotes, tabs for indentation

- [x] Create `src/core/convert/TrashService.ts` — macOS Trash integration:
  - The service should expose:
    - `moveToTrash(filePath: string): Promise<TrashResult>` — moves a file to macOS Trash
  - Define types:
    ```typescript
    export type TrashResult = {
      srcPath: string;
      success: boolean;
      error?: string;
    };
    ```
  - Use `node:child_process` `execFile` (promisified via `util.promisify`) to call `osascript` with an inline AppleScript argument:
    `execFile('osascript', ['-e', 'tell application "Finder" to delete POSIX file "<filePath>"'])`
    Using `execFile` with an args array is critical — it avoids shell interpolation, preventing command injection. Do NOT use `exec` or shell strings. The filePath must be passed as part of the AppleScript string literal within the args array, NOT interpolated into a shell command.
  - This is the standard macOS way to move to Trash (shows in Trash, can be restored by user)
  - Verify the file exists before attempting to trash (throw descriptive error if missing)
  - If `osascript` fails, return `{ success: false, error: <stderr message> }` instead of throwing — this allows the caller to decide how to handle trash failures (non-fatal)
  - Export everything from `src/core/convert/TrashService.ts`

- [x] Create `src/core/convert/ConversionService.spec.ts` — tests for ConversionService:
  - Test `canConvert()`:
    - Returns `true` for `.heic`, `.heif`, `.HEIC` (case-insensitive)
    - Returns `true` for other supported formats (`.png`, `.jpg`, `.tiff`, `.bmp`, `.gif`)
    - Returns `false` for unsupported formats (`.mp4`, `.pdf`, `.txt`, `.zip`)
  - Test `convert()` with mocked `execFile`:
    - Mock `node:child_process` using `vi.mock('node:child_process', ...)`
    - Successful conversion: mock returns exit code 0, verify correct `sips` args are passed, verify `ConvertResult` is returned with correct `srcPath`, `destPath`, `format`
    - Verify JPEG quality option is passed to sips when format is `jpeg`
    - Failed conversion: mock returns non-zero exit code with stderr, verify error is thrown with stderr message
    - Output path collision: mock `fs.access` to simulate existing file, verify `_2` suffix is appended
  - Use Vitest patterns matching existing specs (`describe`, `it`/`test`, `expect`, `vi.fn()`, `vi.mock()`)
  - Place the spec file alongside the source: `src/core/convert/ConversionService.spec.ts`

- [x] Create `src/core/convert/TrashService.spec.ts` — tests for TrashService:
  - Test `moveToTrash()` with mocked `execFile`:
    - Mock `node:child_process` to simulate `osascript` calls
    - Successful trash: mock returns exit code 0, verify `TrashResult.success` is `true`
    - Verify the `osascript` command includes the correct file path in the AppleScript argument
    - Failed trash: mock returns non-zero exit code, verify `TrashResult.success` is `false` and `error` is populated (not thrown)
    - Missing file: mock `fs.access` to throw ENOENT, verify an error is thrown before attempting `osascript`
  - Use same Vitest patterns and temp directory setup as `ConversionService.spec.ts`

- [x] Run the conversion service tests and verify they pass:
  - Run `pnpm test -- src/core/convert/ConversionService.spec.ts`
  - Run `pnpm test -- src/core/convert/TrashService.spec.ts`
  - If any tests fail, fix the implementation and re-run until all pass
  - Run `make typecheck` to ensure no type errors were introduced
  - Run `make lint` to ensure code style compliance
