#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const artifactsDir = path.resolve('artifacts');
const bundleRoot = path.resolve('apps/menu-bar/src-tauri/target/release/bundle');
const bundleDirs = () => {
  if (!fs.existsSync(bundleRoot)) return [];
  return fs
    .readdirSync(bundleRoot)
    .map((name) => path.join(bundleRoot, name))
    .filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
};

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyFromDirs(exts) {
  for (const dir of bundleDirs()) {
    for (const entry of fs.readdirSync(dir)) {
      const match = exts.find((ext) => entry.endsWith(ext));
      if (!match) continue;
      const source = path.join(dir, entry);
      const dest = path.join(artifactsDir, entry);
      if (fs.statSync(source).isFile()) {
        fs.copyFileSync(source, dest);
        console.log(`Copied ${entry}`);
      }
    }
  }
}

function zipApps() {
  for (const dir of bundleDirs()) {
    const apps = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.app'));
    for (const appName of apps) {
      const appPath = path.join(dir, appName);
      if (!fs.statSync(appPath).isDirectory()) continue;
      const safeBase = appName.replace(/\.app$/, '');
      const dest = path.join(artifactsDir, `${safeBase}.app.zip`);
      execSync(`ditto -c -k --sequesterRsrc --keepParent "${appPath}" "${dest}"`, {
        stdio: 'inherit',
      });
      console.log(`Packaged ${appName} -> ${safeBase}.app.zip`);
    }
  }
}

ensureCleanDir(artifactsDir);
zipApps();
copyFromDirs(['.dmg', '.zip', '.tar.gz']);

const prepared = fs.readdirSync(artifactsDir);
console.log('Artifacts prepared:', prepared);
