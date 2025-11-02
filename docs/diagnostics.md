# Diagnostics & Debugging Guide

This guide collects the quick checks, commands, and workflows useful for troubleshooting Namefix’s CLI, service core, and macOS menu bar app.

---

## 1. First-Line Checks

### Confirm Processes
```bash
ps -ef | grep -i namefix
```
- Expect `namefix_menu_bar` when the tray app is running.
- Absence indicates the bundle crashed or never launched.

### Clear Gatekeeper Quarantine
Unsigned builds are quarantined after download and will be blocked.
```bash
xattr -dr com.apple.quarantine "/Applications/Namefix Menu Bar.app"
```
- Run this once after installing each new unsigned build.
- Without it macOS shows “Namefix Menu Bar is damaged” and aborts launch.

---

## 2. Logs & Crash Reports

### Service Logs
Namefix writes JSON logs to:
```
~/Library/Logs/namefix/session.log
```
Use `tail -f` while reproducing issues.

### macOS Crash Reports
Crashes are captured as `.ips` files:
```
~/Library/Logs/DiagnosticReports/namefix_menu_bar-*.ips
```
Open the most recent file to inspect stack traces and panic reasons.

### Unified Logging
When the process starts but misbehaves, query the system log:
```bash
log show --predicate 'process == "namefix_menu_bar"' --last 10m
```

---

## 3. Interactive Debug Sessions

### lldb
Run the packaged app under lldb to capture panic output:
```bash
lldb -Q \
  -o "target create '/Applications/Namefix Menu Bar.app/Contents/MacOS/namefix_menu_bar'" \
  -o run \
  -o quit
```
Example failure we hit:
```
Failed to setup app: error encountered during setup hook: service bridge script not found
```

### Manual Launch
For quick repro without debugger:
```bash
"/Applications/Namefix Menu Bar.app/Contents/MacOS/namefix_menu_bar"
```
Use `RUST_BACKTRACE=1` in development environments for full stack traces.

---

## 4. Validating Bundled Assets

### Verify Resource Layout
Release builds should include the bridge script at:
```
Contents/Resources/resources/service-bridge.mjs
```
Check an installed app with:
```bash
ls "/Applications/Namefix Menu Bar.app/Contents/Resources/resources"
```

### GitHub Release Artifacts
Confirm the DMG/ZIP assets on the latest tag:
```bash
gh release view v0.2.3 --json assets
```

---

## 5. CI & Release Pipeline

### Monitor Workflows
```bash
gh run list --workflow Release --limit 5
gh run view <run-id> --job <job-id> --log | tail
```
Common failures:
- Node version mismatch (`semantic-release` engine requirement).
- Missing Tauri artifacts (`artifacts/*.dmg cannot be read`).
- GitHub token lacking `issues`/`pull-requests` scopes.

### Clean Up Manual Tags
Semantic Release owns versioning. Remove stale manual tags if needed:
```bash
git tag -d v0.3.0
git push origin :refs/tags/v0.3.0
```

---

## 6. Common Failure Modes

| Symptom | Likely Cause | Steps |
| --- | --- | --- |
| “App is damaged” dialog | Quarantine flag from unsigned build | `xattr -dr …` |
| App never appears in menu bar | Panic during setup (`service-bridge.mjs` missing, etc.) | Inspect crash report, run via lldb |
| CLI/service rename errors | Source file disappeared mid-rename | Tail `session.log`, reproduce with `namefix --dry-run` |
| Release workflow fails | Missing artifacts or insufficient token scopes | Review workflow logs, ensure `collect-artifacts.mjs` copies bundles |
| Semantic-release skips version | No `feat`/`fix`/`BREAKING` commits | Merge a conventional commit that bumps version |

---

## 7. Future Improvements

- **Notarization & Signing** – integrate Developer ID signing to eliminate Gatekeeper prompts.
- **CI Smoke Tests** – add checks ensuring the DMG contains required resources (`service-bridge.mjs`, binaries).
- **Runtime Self-Checks** – add user-facing errors if the Node bridge refuses to start.

Keep this document updated as new issues surface or the tooling changes.
