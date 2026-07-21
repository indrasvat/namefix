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

function updateJsonVersion(filePath) {
	const absolute = path.resolve(filePath);
	const contents = fs.readFileSync(absolute, 'utf8');
	JSON.parse(contents);

	const versionField = /^(\s*"version"\s*:\s*)"[^"]+"/m;
	if (!versionField.test(contents)) {
		throw new Error(`Unable to find a top-level version field in ${filePath}`);
	}
	const updated = contents.replace(versionField, `$1"${semver}"`);

	fs.writeFileSync(absolute, updated);
	console.log(`Updated ${filePath}`);
}

updateJsonVersion('package.json');
updateJsonVersion('apps/menu-bar/package.json');
updateJsonVersion('apps/menu-bar/src-tauri/tauri.conf.json');

const cargoTomlPath = path.resolve('apps/menu-bar/src-tauri/Cargo.toml');
const cargo = fs.readFileSync(cargoTomlPath, 'utf8');
fs.writeFileSync(cargoTomlPath, cargo.replace(/^version = ".*"/m, `version = "${semver}"`));
console.log('Updated apps/menu-bar/src-tauri/Cargo.toml');
