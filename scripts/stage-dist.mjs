#!/usr/bin/env node

import { cp, rm, symlink, mkdir } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const persist = args.includes('--persist');
const filteredArgs = args.filter((arg) => arg !== '--persist');

if (filteredArgs.length === 0) {
  console.error('Usage: node scripts/stage-dist.mjs <command> [..args]');
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(new URL(import.meta.url))), '..');
const distSource = path.join(repoRoot, 'dist');
const stagedDist = path.join(repoRoot, 'apps', 'menu-bar', 'src-tauri', 'resources', 'dist');

if (!fs.existsSync(distSource)) {
  console.error(`Source dist directory not found at ${distSource}. Run \`npm run build\` first.`);
  process.exit(1);
}

async function stageDist() {
  await rm(stagedDist, { recursive: true, force: true });
  if (persist) {
    await mkdir(path.dirname(stagedDist), { recursive: true });
    await symlink(distSource, stagedDist, 'dir');
    console.log(`Linked dist → ${stagedDist}`);
  } else {
    await cp(distSource, stagedDist, { recursive: true });
    console.log(`Staged dist → ${stagedDist}`);
  }
  const sample = fs.readdirSync(stagedDist, { withFileTypes: true })
    .slice(0, 5)
    .map((entry) => `${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`);
  console.log(`Staged dist contents: ${sample.join(', ')}`);
}

async function cleanupDist() {
  await rm(stagedDist, { recursive: true, force: true });
  console.log(`Cleaned staged dist from ${stagedDist}`);
}

async function run() {
  await stageDist();
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(filteredArgs[0], filteredArgs.slice(1), {
        cwd: path.join(repoRoot, 'apps', 'menu-bar'),
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      child.on('exit', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Command exited with ${code ?? signal}`));
      });
      child.on('error', reject);
    });
  } finally {
    if (!persist) {
      await cleanupDist();
    }
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
