#!/usr/bin/env node

import { cp, rm, symlink, mkdir, readdir, realpath } from 'node:fs/promises';
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
const nodeModulesSource = path.join(repoRoot, 'node_modules');
const resourcesRoot = path.join(repoRoot, 'apps', 'menu-bar', 'src-tauri', 'resources');
const stagedDist = path.join(resourcesRoot, 'dist');
const stagedModules = path.join(resourcesRoot, 'node_modules');

if (!fs.existsSync(distSource)) {
	console.error(`Source dist directory not found at ${distSource}. Run \`npm run build\` first.`);
	process.exit(1);
}

if (!fs.existsSync(nodeModulesSource)) {
	console.error(`node_modules not found at ${nodeModulesSource}. Did you run \`npm ci\`?`);
	process.exit(1);
}

/**
 * Copy production dependencies from node_modules into the staged directory.
 * pnpm uses symlinks for top-level packages (e.g. picomatch -> .pnpm/picomatch@.../...).
 * Tauri's resource bundler skips symlinks, so we resolve each dependency to its
 * real path and copy the actual files. Only production deps are needed — the
 * menu bar bridge only imports from the core service layer.
 */
async function stageNodeModules() {
	await rm(stagedModules, { recursive: true, force: true });
	await mkdir(stagedModules, { recursive: true });

	const pkgPath = path.join(repoRoot, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	const prodDeps = Object.keys(pkg.dependencies || {});

	let copied = 0;
	for (const dep of prodDeps) {
		const src = path.join(nodeModulesSource, dep);
		if (!fs.existsSync(src)) {
			console.warn(`  WARN: dependency "${dep}" not found in node_modules, skipping`);
			continue;
		}
		const resolved = await realpath(src);
		const dest = path.join(stagedModules, dep);
		await cp(resolved, dest, { recursive: true });
		copied++;
	}

	console.log(`Staged ${copied} production dependencies`);
}

async function stageDist() {
	await rm(stagedDist, { recursive: true, force: true });
	if (persist) {
		await mkdir(resourcesRoot, { recursive: true });
		await symlink(distSource, stagedDist, 'dir');
		await rm(stagedModules, { recursive: true, force: true });
		await symlink(nodeModulesSource, stagedModules, 'dir');
		console.log(`Linked dist → ${stagedDist}`);
	} else {
		await cp(distSource, stagedDist, { recursive: true });
		await stageNodeModules();
		console.log(`Staged dist → ${stagedDist}`);
	}
	const sample = fs
		.readdirSync(stagedDist, { withFileTypes: true })
		.slice(0, 5)
		.map((entry) => `${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`);
	console.log(`Staged dist contents: ${sample.join(', ')}`);
}

async function cleanupDist() {
	await rm(stagedDist, { recursive: true, force: true });
	await rm(stagedModules, { recursive: true, force: true });
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
