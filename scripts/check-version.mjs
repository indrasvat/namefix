#!/usr/bin/env node

import fs from 'node:fs';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const expected = process.argv[2]?.replace(/^v/, '');

function readJsonVersion(filePath) {
	const value = JSON.parse(fs.readFileSync(filePath, 'utf8')).version;
	if (typeof value !== 'string') {
		throw new Error(`${filePath} does not contain a string version`);
	}
	return value;
}

function readCargoManifestVersion(filePath) {
	const contents = fs.readFileSync(filePath, 'utf8');
	const packageStart = contents.search(/^\[package\]\s*$/m);
	if (packageStart === -1) {
		throw new Error(`${filePath} does not contain a [package] section`);
	}

	const afterHeader = contents.slice(packageStart).replace(/^\[package\]\s*$/m, '');
	const nextSection = afterHeader.search(/^\[/m);
	const packageSection = nextSection === -1 ? afterHeader : afterHeader.slice(0, nextSection);
	const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
	if (!version) {
		throw new Error(`${filePath} does not contain [package].version`);
	}
	return version;
}

function readCargoLockVersion(filePath, packageName) {
	const contents = fs.readFileSync(filePath, 'utf8');
	for (const block of contents.split(/^\[\[package\]\]\s*$/m).slice(1)) {
		const name = block.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
		if (name !== packageName) continue;

		const version = block.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
		if (!version) {
			throw new Error(`${filePath} has no version for ${packageName}`);
		}
		return version;
	}
	throw new Error(`${filePath} has no package named ${packageName}`);
}

const versions = new Map([
	['package.json', readJsonVersion('package.json')],
	['apps/menu-bar/package.json', readJsonVersion('apps/menu-bar/package.json')],
	[
		'apps/menu-bar/src-tauri/tauri.conf.json',
		readJsonVersion('apps/menu-bar/src-tauri/tauri.conf.json'),
	],
	[
		'apps/menu-bar/src-tauri/Cargo.toml',
		readCargoManifestVersion('apps/menu-bar/src-tauri/Cargo.toml'),
	],
	[
		'apps/menu-bar/src-tauri/Cargo.lock (namefix_menu_bar)',
		readCargoLockVersion('apps/menu-bar/src-tauri/Cargo.lock', 'namefix_menu_bar'),
	],
]);

const baseline = expected ?? versions.values().next().value;
const errors = [];

if (!baseline || !VERSION_RE.test(baseline)) {
	errors.push(`expected version is not valid semver: ${baseline ?? '<missing>'}`);
}

for (const [source, version] of versions) {
	if (!VERSION_RE.test(version)) {
		errors.push(`${source} contains invalid semver: ${version}`);
	} else if (version !== baseline) {
		errors.push(`${source} is ${version}; expected ${baseline}`);
	}
}

if (errors.length > 0) {
	console.error('Version consistency check failed:');
	for (const error of errors) console.error(`  - ${error}`);
	process.exit(1);
}

console.log(`All ${versions.size} version sources agree on ${baseline}.`);
