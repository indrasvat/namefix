#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const artifactsDir = path.resolve('artifacts');
const bundleRoot = path.resolve('apps/menu-bar/src-tauri/target/release/bundle');
const macBundleDir = path.join(bundleRoot, 'macos');

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyIfExists(globExt) {
  if (!fs.existsSync(macBundleDir)) return;
  const entries = fs.readdirSync(macBundleDir).filter((name) => name.endsWith(globExt));
  for (const entry of entries) {
    const source = path.join(macBundleDir, entry);
    const dest = path.join(artifactsDir, entry);
    fs.copyFileSync(source, dest);
    console.log(`Copied ${entry}`);
  }
}

function zipApps() {
  if (!fs.existsSync(macBundleDir)) return;
  const apps = fs.readdirSync(macBundleDir).filter((name) => name.endsWith('.app'));
  for (const appName of apps) {
    const appPath = path.join(macBundleDir, appName);
    const base = appName.replace(/\.app$/, '');
    const dest = path.join(artifactsDir, `${base}.app.zip`);
    execSync(`ditto -c -k --sequesterRsrc --keepParent "${appPath}" "${dest}"`, { stdio: 'inherit' });
    console.log(`Packaged ${appName} -> ${base}.app.zip`);
  }
}

ensureCleanDir(artifactsDir);
zipApps();
copyIfExists('.dmg');
copyIfExists('.zip');
copyIfExists('.tar.gz');

console.log('Artifacts prepared:', fs.readdirSync(artifactsDir));
