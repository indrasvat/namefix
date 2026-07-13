import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cacheDir, configDir, desktopPath, logsDir, stateDir } from './paths.js';

const ENV_KEYS = [
	'NAMEFIX_HOME',
	'NAMEFIX_LOGS',
	'XDG_CONFIG_HOME',
	'XDG_STATE_HOME',
	'XDG_CACHE_HOME',
];
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const key of ENV_KEYS) {
		originalEnv[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = originalEnv[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe('configDir', () => {
	it('falls back to default app name when input is blank', () => {
		process.env.XDG_CONFIG_HOME = '/tmp/config';
		const result = configDir('   ');
		expect(result).toBe(path.join('/tmp/config', 'namefix'));
	});

	it('trims surrounding whitespace from custom app names', () => {
		process.env.XDG_CONFIG_HOME = '/tmp/config';
		const result = configDir('  demo-app  ');
		expect(result).toBe(path.join('/tmp/config', 'demo-app'));
	});
});

describe('runtime directories', () => {
	it('uses explicit app overrides before XDG config locations', () => {
		process.env.NAMEFIX_HOME = '/tmp/namefix-home';
		process.env.XDG_CONFIG_HOME = '/tmp/config';

		expect(configDir('demo')).toBe('/tmp/namefix-home');
	});

	it('uses XDG state/cache/log locations with sanitized app names', () => {
		process.env.XDG_STATE_HOME = '/tmp/state';
		process.env.XDG_CACHE_HOME = '/tmp/cache';

		expect(stateDir(' demo ')).toBe(path.join('/tmp/state', 'demo'));
		expect(cacheDir(' demo ')).toBe(path.join('/tmp/cache', 'demo'));
		expect(logsDir(' demo ')).toBe(path.join('/tmp/state', 'demo', 'logs'));
	});

	it('uses explicit log overrides before state defaults', () => {
		process.env.NAMEFIX_LOGS = '/tmp/namefix-logs';
		process.env.XDG_STATE_HOME = '/tmp/state';

		expect(logsDir('demo')).toBe('/tmp/namefix-logs');
	});

	it('returns the home Desktop path', () => {
		expect(desktopPath()).toBe(path.join(process.env.HOME ?? '', 'Desktop'));
	});
});
