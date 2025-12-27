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
});
