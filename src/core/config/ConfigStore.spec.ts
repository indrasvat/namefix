import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { ConfigStore } from './ConfigStore.js';

let tempRoot: string;

beforeEach(async () => {
	tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'namefix-config-'));
	process.env.NAMEFIX_HOME = path.join(tempRoot, 'config');
	process.env.NAMEFIX_LOGS = path.join(tempRoot, 'logs');
});

afterEach(async () => {
	process.env.NAMEFIX_HOME = undefined;
	process.env.NAMEFIX_LOGS = undefined;
	await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('ConfigStore', () => {
	it('provides defaults and persists schema additions', async () => {
		const store = new ConfigStore();
		const cfg = await store.get();
		expect(cfg.watchDirs.length).toBeGreaterThan(0);
		expect(cfg.launchOnLogin).toBe(false);
		const configHome = process.env.NAMEFIX_HOME;
		expect(configHome).toBeDefined();
		if (!configHome) {
			throw new Error('NAMEFIX_HOME should be defined');
		}
		const persisted = await fs.readFile(path.join(configHome, 'config.json'), 'utf8');
		const parsed = JSON.parse(persisted);
		expect(parsed.watchDirs).toEqual(cfg.watchDirs);
	});

	it('deduplicates and normalizes watch directories', async () => {
		const store = new ConfigStore();
		const dirA = path.join(tempRoot, 'A');
		const dirB = path.join(tempRoot, 'B');
		const result = await store.set({ watchDirs: [dirA, dirB, dirA], watchDir: dirB });
		expect(result.watchDirs).toEqual([path.resolve(dirB), path.resolve(dirA)]);
		expect(result.watchDir).toBe(path.resolve(dirB));
	});

	it('promotes new primary watch directory when needed', async () => {
		const store = new ConfigStore();
		const base = await store.get();
		const dirC = path.join(tempRoot, 'C');
		const updated = await store.set({ watchDir: dirC });
		expect(updated.watchDir).toBe(path.resolve(dirC));
		expect(updated.watchDirs[0]).toBe(path.resolve(dirC));
		expect(updated.watchDirs).toContain(base.watchDirs[0]);
	});

	it('loads configs without action field (backward compat)', async () => {
		const configHome = process.env.NAMEFIX_HOME;
		if (!configHome) throw new Error('NAMEFIX_HOME should be defined');
		await fs.mkdir(configHome, { recursive: true });
		const legacyConfig = {
			watchDir: path.join(tempRoot, 'watch'),
			watchDirs: [path.join(tempRoot, 'watch')],
			prefix: 'Screenshot',
			include: ['Screenshot*'],
			exclude: [],
			dryRun: true,
			theme: 'default',
			launchOnLogin: false,
			profiles: [
				{
					id: 'screenshots',
					name: 'Screenshots',
					enabled: true,
					pattern: 'Screenshot*',
					isRegex: false,
					template: '<prefix>_<datetime>',
					prefix: 'Screenshot',
					priority: 1,
				},
			],
		};
		await fs.writeFile(
			path.join(configHome, 'config.json'),
			JSON.stringify(legacyConfig, null, 2),
			'utf8',
		);

		const store = new ConfigStore();
		const cfg = await store.get();
		// The saved profile plus missing defaults (heic-convert, screen-recordings) are merged in
		const screenshots = cfg.profiles.find((p) => p.id === 'screenshots');
		expect(screenshots).toBeDefined();
		expect(screenshots?.action).toBeUndefined();
		// Default profiles that were missing should be added
		const heic = cfg.profiles.find((p) => p.id === 'heic-convert');
		expect(heic).toBeDefined();
		expect(heic?.action).toBe('convert');
	});

	it('accepts profiles with valid action values', async () => {
		const configHome = process.env.NAMEFIX_HOME;
		if (!configHome) throw new Error('NAMEFIX_HOME should be defined');
		await fs.mkdir(configHome, { recursive: true });
		const configWithActions = {
			watchDir: path.join(tempRoot, 'watch'),
			watchDirs: [path.join(tempRoot, 'watch')],
			prefix: 'Screenshot',
			include: ['Screenshot*'],
			exclude: [],
			dryRun: true,
			theme: 'default',
			launchOnLogin: false,
			profiles: [
				{
					id: 'p1',
					name: 'Rename Only',
					enabled: true,
					pattern: 'Screenshot*',
					isRegex: false,
					template: '<prefix>_<datetime>',
					prefix: 'Screenshot',
					priority: 1,
					action: 'rename',
				},
				{
					id: 'p2',
					name: 'Convert Only',
					enabled: true,
					pattern: '*.heic',
					isRegex: false,
					template: '<original>',
					prefix: '',
					priority: 0,
					action: 'convert',
				},
				{
					id: 'p3',
					name: 'Both',
					enabled: true,
					pattern: '*.heif',
					isRegex: false,
					template: '<prefix>_<datetime>',
					prefix: 'Photo',
					priority: 2,
					action: 'rename+convert',
				},
			],
		};
		await fs.writeFile(
			path.join(configHome, 'config.json'),
			JSON.stringify(configWithActions, null, 2),
			'utf8',
		);

		const store = new ConfigStore();
		const cfg = await store.get();
		// 3 saved + missing defaults merged in
		const p1 = cfg.profiles.find((p) => p.id === 'p1');
		const p2 = cfg.profiles.find((p) => p.id === 'p2');
		const p3 = cfg.profiles.find((p) => p.id === 'p3');
		expect(p1?.action).toBe('rename');
		expect(p2?.action).toBe('convert');
		expect(p3?.action).toBe('rename+convert');
	});

	it('adds missing default profiles to existing configs', async () => {
		const configHome = process.env.NAMEFIX_HOME;
		if (!configHome) throw new Error('NAMEFIX_HOME should be defined');
		await fs.mkdir(configHome, { recursive: true });
		// Config with only screenshots — missing heic-convert and screen-recordings
		const oldConfig = {
			watchDir: path.join(tempRoot, 'watch'),
			watchDirs: [path.join(tempRoot, 'watch')],
			prefix: 'Screenshot',
			include: ['Screenshot*'],
			exclude: [],
			dryRun: true,
			theme: 'default',
			launchOnLogin: false,
			profiles: [
				{
					id: 'screenshots',
					name: 'Screenshots',
					enabled: true,
					pattern: 'Screenshot*',
					isRegex: false,
					template: '<prefix>_<datetime>',
					prefix: 'Screenshot',
					priority: 1,
				},
			],
		};
		await fs.writeFile(
			path.join(configHome, 'config.json'),
			JSON.stringify(oldConfig, null, 2),
			'utf8',
		);

		const store = new ConfigStore();
		const cfg = await store.get();
		// Original profile preserved
		expect(cfg.profiles.find((p) => p.id === 'screenshots')).toBeDefined();
		// Missing defaults added
		expect(cfg.profiles.find((p) => p.id === 'heic-convert')).toBeDefined();
		expect(cfg.profiles.find((p) => p.id === 'screen-recordings')).toBeDefined();
		// heic-convert appears before user profiles (prepended)
		const heicIdx = cfg.profiles.findIndex((p) => p.id === 'heic-convert');
		const screenshotsIdx = cfg.profiles.findIndex((p) => p.id === 'screenshots');
		expect(heicIdx).toBeLessThan(screenshotsIdx);
	});

	it('includes heic-convert default profile in fresh configs', async () => {
		const store = new ConfigStore();
		const cfg = await store.get();
		const heicProfile = cfg.profiles.find((p) => p.id === 'heic-convert');
		expect(heicProfile).toBeDefined();
		expect(heicProfile?.name).toBe('HEIC to JPEG');
		expect(heicProfile?.action).toBe('convert');
		expect(heicProfile?.pattern).toBe('*.heic');
		expect(heicProfile?.priority).toBe(0);
	});
});
