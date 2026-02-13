import fs from 'node:fs/promises';
import fscb from 'node:fs';
import path from 'node:path';
import type { IConfig, IConfigStore, IProfile } from '../../types/index';
import { configDir } from '../../utils/paths.js';
import { DEFAULT_PROFILES, DEFAULT_TEMPLATE, generateProfileId } from '../rename/NameTemplate.js';

const DEFAULT_WATCH_DIR = process.env.HOME ? path.join(process.env.HOME, 'Desktop') : '';

const DEFAULT_CONFIG: IConfig = {
	watchDir: DEFAULT_WATCH_DIR,
	watchDirs: DEFAULT_WATCH_DIR ? [DEFAULT_WATCH_DIR] : [],
	prefix: 'Screenshot',
	include: ['Screenshot*'],
	exclude: [],
	dryRun: true,
	theme: 'default',
	launchOnLogin: false,
	profiles: [...DEFAULT_PROFILES],
};

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

const VALID_ACTIONS = new Set(['rename', 'convert', 'rename+convert']);

function isValidProfile(p: unknown): p is IProfile {
	if (typeof p !== 'object' || p === null) return false;
	const obj = p as Record<string, unknown>;
	const baseValid =
		typeof obj.id === 'string' &&
		typeof obj.name === 'string' &&
		typeof obj.enabled === 'boolean' &&
		typeof obj.pattern === 'string' &&
		typeof obj.template === 'string' &&
		typeof obj.prefix === 'string' &&
		typeof obj.priority === 'number';
	if (!baseValid) return false;
	// action is optional; if present, must be a valid value
	if (obj.action !== undefined && !VALID_ACTIONS.has(obj.action as string)) return false;
	return true;
}

function isProfileArray(v: unknown): v is IProfile[] {
	return Array.isArray(v) && v.every(isValidProfile);
}

/**
 * Ensure all DEFAULT_PROFILES exist in an existing profiles array.
 * Adds any missing defaults (matched by id) without disturbing user profiles.
 */
function ensureDefaultProfiles(profiles: IProfile[]): IProfile[] {
	const existingIds = new Set(profiles.map((p) => p.id));
	const missing = DEFAULT_PROFILES.filter((dp) => !existingIds.has(dp.id));
	if (missing.length === 0) return profiles;
	return [...missing, ...profiles];
}

/**
 * Migrate legacy config (prefix/include/exclude) to profiles array.
 * Only runs if profiles array is empty or missing.
 */
function migrateToProfiles(input: Partial<IConfig>): IProfile[] {
	// If profiles already exist and are valid, ensure new defaults are merged in
	if (isProfileArray(input.profiles) && input.profiles.length > 0) {
		return ensureDefaultProfiles(input.profiles);
	}

	// Check if we have legacy config to migrate
	const hasLegacyConfig =
		(typeof input.prefix === 'string' && input.prefix.length > 0) ||
		(isStringArray(input.include) && input.include.length > 0);

	if (!hasLegacyConfig) {
		// No legacy config, use defaults
		return [...DEFAULT_PROFILES];
	}

	// Migrate legacy config to a single profile
	const prefix = typeof input.prefix === 'string' ? input.prefix : 'Screenshot';
	const include = isStringArray(input.include) ? input.include : ['Screenshot*'];

	// Create a profile for each include pattern
	const profiles: IProfile[] = include.map((pattern, index) => ({
		id: generateProfileId(),
		name: `Migrated: ${pattern}`,
		enabled: true,
		pattern,
		isRegex: false,
		template: DEFAULT_TEMPLATE,
		prefix,
		priority: index + 1,
	}));

	// Add default profiles that don't conflict
	for (const defaultProfile of DEFAULT_PROFILES) {
		const patternExists = profiles.some((p) => p.pattern === defaultProfile.pattern);
		if (!patternExists) {
			profiles.push({
				...defaultProfile,
				id: defaultProfile.id,
				priority: profiles.length + 1,
			});
		}
	}

	return profiles;
}

function validateConfig(input: Partial<IConfig>): IConfig {
	const cfg: IConfig = { ...DEFAULT_CONFIG, ...input } as IConfig;
	const candidateDirs = Array.isArray(input.watchDirs)
		? input.watchDirs
		: input.watchDir
			? [input.watchDir]
			: cfg.watchDirs;
	cfg.watchDirs = sanitizeDirs(candidateDirs);
	if (typeof cfg.watchDir !== 'string' || cfg.watchDir.length === 0) {
		cfg.watchDir = cfg.watchDirs[0] ?? DEFAULT_CONFIG.watchDir;
	}
	if (cfg.watchDir) {
		cfg.watchDirs = [cfg.watchDir, ...cfg.watchDirs.filter((dir) => dir !== cfg.watchDir)];
	}
	if (!cfg.watchDirs.length && cfg.watchDir) {
		cfg.watchDirs = [cfg.watchDir];
	}
	if (typeof cfg.prefix !== 'string' || cfg.prefix.length === 0) cfg.prefix = DEFAULT_CONFIG.prefix;
	if (!isStringArray(cfg.include) || cfg.include.length === 0) cfg.include = DEFAULT_CONFIG.include;
	if (!isStringArray(cfg.exclude)) cfg.exclude = DEFAULT_CONFIG.exclude;
	if (typeof cfg.dryRun !== 'boolean') cfg.dryRun = DEFAULT_CONFIG.dryRun;
	if (typeof cfg.theme !== 'string' || cfg.theme.length === 0) cfg.theme = DEFAULT_CONFIG.theme;
	if (typeof cfg.launchOnLogin !== 'boolean') cfg.launchOnLogin = DEFAULT_CONFIG.launchOnLogin;

	// Handle profiles migration and validation
	cfg.profiles = migrateToProfiles(input);

	return cfg;
}

async function ensureDir(p: string) {
	await fs.mkdir(p, { recursive: true });
}

function sanitizeDirs(rawDirs: unknown): string[] {
	const dirs: string[] = [];
	if (Array.isArray(rawDirs)) {
		for (const entry of rawDirs) {
			if (typeof entry === 'string' && entry.trim().length > 0)
				dirs.push(path.resolve(entry.trim()));
		}
	}
	if (!dirs.length && DEFAULT_CONFIG.watchDir) dirs.push(path.resolve(DEFAULT_CONFIG.watchDir));
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const dir of dirs) {
		if (seen.has(dir)) continue;
		seen.add(dir);
		normalized.push(dir);
	}
	return normalized;
}

export class ConfigStore implements IConfigStore {
	private current: IConfig | null = null;
	private listeners = new Set<(config: IConfig) => void>();

	async get(): Promise<IConfig> {
		if (this.current) return this.current;
		const cfgDir = configDir('namefix');
		const configFile = path.join(cfgDir, 'config.json');
		try {
			await ensureDir(cfgDir);
		} catch {
			/* non-fatal (sandbox) */
		}
		try {
			const raw = await fs.readFile(configFile, 'utf8');
			const parsed = JSON.parse(raw);
			const valid = validateConfig(parsed);
			this.current = valid;
			return valid;
		} catch (err: unknown) {
			if ((isNodeError(err) && err.code === 'ENOENT') || err instanceof SyntaxError) {
				this.current = DEFAULT_CONFIG;
				await this.persist(DEFAULT_CONFIG);
				return DEFAULT_CONFIG;
			}
			// If invalid JSON or other error, fall back to defaults but keep file for manual fix
			this.current = DEFAULT_CONFIG;
			return DEFAULT_CONFIG;
		}
	}

	async set(next: Partial<IConfig>): Promise<IConfig> {
		const merged = validateConfig({ ...(await this.get()), ...next });
		await this.persist(merged);
		this.current = merged;
		this.emitChange(merged);
		return merged;
	}

	onChange(cb: (config: IConfig) => void): () => void {
		this.listeners.add(cb);
		if (this.current) cb(this.current);
		return () => this.listeners.delete(cb);
	}

	private emitChange(cfg: IConfig) {
		for (const cb of this.listeners) {
			try {
				cb(cfg);
			} catch {
				/* ignore listener errors */
			}
		}
	}

	private async persist(cfg: IConfig): Promise<void> {
		const cfgDir = configDir('namefix');
		const configFile = path.join(cfgDir, 'config.json');
		try {
			await ensureDir(cfgDir);
			const tmp = `${configFile}.tmp`;
			const data = JSON.stringify(cfg, null, 2);
			await fs.writeFile(tmp, data, 'utf8');
			await fs.rename(tmp, configFile);
			try {
				const fd = await fs.open(configFile, 'r');
				await fd.sync();
				await fd.close();
			} catch {
				/* ignore */
			}
			try {
				fscb.chmodSync(configFile, 0o600);
			} catch {
				/* ignore */
			}
		} catch {
			// In read-only/sandboxed env, skip persistence
		}
	}
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === 'object' && err !== null && 'code' in err;
}
