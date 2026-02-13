#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const raw = process.argv[2];

if (!raw) {
	console.error('Usage: node scripts/set-version.mjs <version|tag>');
	process.exit(1);
}

const semver = raw.startsWith('v') ? raw.slice(1) : raw;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?$/;
if (!SEMVER_RE.test(semver)) {
	console.error(`Invalid semver version: ${raw}`);
	process.exit(1);
}

function updateJson(filePath, mutator) {
	const absolute = path.resolve(filePath);
	const json = JSON.parse(fs.readFileSync(absolute, 'utf8'));
	const updated = mutator(json) ?? json;
	fs.writeFileSync(absolute, `${JSON.stringify(updated, null, 2)}\n`);
	console.log(`Updated ${filePath}`);
}

updateJson('package.json', (pkg) => {
	pkg.version = semver;
	return pkg;
});

updateJson('apps/menu-bar/package.json', (pkg) => {
	pkg.version = semver;
	return pkg;
});

const tauriConfigPath = path.resolve('apps/menu-bar/src-tauri/tauri.conf.json');
const tauri = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
tauri.version = semver;
fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauri, null, 2)}\n`);
console.log('Updated apps/menu-bar/src-tauri/tauri.conf.json');

const cargoTomlPath = path.resolve('apps/menu-bar/src-tauri/Cargo.toml');
const cargo = fs.readFileSync(cargoTomlPath, 'utf8');
fs.writeFileSync(cargoTomlPath, cargo.replace(/^version = ".*"/m, `version = "${semver}"`));
console.log('Updated apps/menu-bar/src-tauri/Cargo.toml');
