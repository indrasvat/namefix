import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import type {
	IConfig,
	IConfigStore,
	IWatchService,
	ILogger,
	IProfile,
	WatchServiceErrorHandler,
} from '../types/index.js';
import { ConfigStore } from './config/ConfigStore.js';
import { Logger } from './log/Logger.js';
import { EventBus } from './events/EventBus.js';
import { RenameService } from './rename/RenameService.js';
import { Matcher, ProfileMatcher } from './rename/Matcher.js';
import { FsSafe } from './fs/FsSafe.js';
import { WatchService } from './fs/WatchService.js';
import { JournalStore } from './journal/JournalStore.js';
import { ConversionService } from './convert/ConversionService.js';
import { TrashService } from './convert/TrashService.js';
import type { ServiceEventMap, ServiceStatus } from '../types/service.js';
import { TypedEmitter } from '../utils/TypedEmitter.js';

/**
 * Shared orchestrator responsible for configuration, directory watching, and rename lifecycles.
 *
 * Emits typed events (`ServiceEventMap`) consumable by both the CLI/TUI and external front-ends.
 */
export class NamefixService {
	private emitter = new TypedEmitter<ServiceEventMap>();
	private configStore: IConfigStore;
	private logger: ILogger;
	private eventBus: EventBus;
	private renamer: RenameService;
	private converter: ConversionService;
	private trasher: TrashService;
	private fsSafe: FsSafe;
	private journal: JournalStore;
	/** @deprecated Legacy matcher for backwards compatibility */
	private matcher: Matcher | null = null;
	/** Profile-based matcher for new config format */
	private profileMatcher: ProfileMatcher | null = null;
	private watchers = new Map<string, IWatchService>();
	private watcherErrorUnsubscribers = new Map<string, () => void>();
	private running = false;
	private config: IConfig | null = null;
	private unsubscribeConfig: (() => void) | null = null;
	private watcherLock: Promise<void> = Promise.resolve();
	private createWatcher: (dir: string, fsSafe: FsSafe) => IWatchService;

	// Health monitoring
	private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
	private static readonly HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds
	private static readonly MAX_RESTART_ATTEMPTS = 3;
	private watcherRestartAttempts = new Map<string, number>();

	constructor(
		deps: {
			configStore?: IConfigStore;
			logger?: ILogger;
			eventBus?: EventBus;
			fsSafe?: FsSafe;
			renamer?: RenameService;
			converter?: ConversionService;
			trasher?: TrashService;
			watcherFactory?: (dir: string, fsSafe: FsSafe) => IWatchService;
		} = {},
	) {
		this.configStore = deps.configStore ?? new ConfigStore();
		this.logger = deps.logger ?? new Logger();
		this.eventBus = deps.eventBus ?? new EventBus();
		this.fsSafe = deps.fsSafe ?? new FsSafe();
		this.renamer = deps.renamer ?? new RenameService();
		this.converter = deps.converter ?? new ConversionService();
		this.trasher = deps.trasher ?? new TrashService();
		this.journal = new JournalStore(this.fsSafe);
		this.createWatcher = deps.watcherFactory ?? ((dir, fsSafe) => new WatchService(dir, fsSafe));
	}

	async init(overrides?: Partial<IConfig>): Promise<IConfig> {
		let cfg = await this.configStore.get();
		if (overrides && Object.keys(overrides).length > 0) {
			cfg = await this.configStore.set({ ...overrides });
		}
		this.applyConfig(cfg);
		this.unsubscribeConfig = this.configStore.onChange((next) => {
			this.applyConfig(next);
			if (this.running) {
				this.syncWatchers().catch((err) => {
					this.logger.error(err instanceof Error ? err : String(err));
				});
			}
			this.emit('config', next);
			this.eventBus.emit('config:changed', { key: undefined });
		});
		return cfg;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.watcherRestartAttempts.clear();
		await this.syncWatchers();
		this.startHealthMonitor();
		this.emitStatus();
	}

	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;
		this.stopHealthMonitor();
		await this.syncWatchers();
		this.emitStatus();
	}

	async toggleRunning(): Promise<void> {
		if (this.running) await this.stop();
		else await this.start();
	}

	async setConfig(next: Partial<IConfig>): Promise<IConfig> {
		return await this.configStore.set(next);
	}

	async setDryRun(value: boolean): Promise<IConfig> {
		return await this.configStore.set({ dryRun: value });
	}

	async setLaunchOnLogin(value: boolean): Promise<IConfig> {
		return await this.configStore.set({ launchOnLogin: value });
	}

	/**
	 * Get all configured profiles.
	 */
	getProfiles(): IProfile[] {
		return this.getConfig().profiles ?? [];
	}

	/**
	 * Get a profile by ID.
	 */
	getProfile(id: string): IProfile | undefined {
		return this.getProfiles().find((p) => p.id === id);
	}

	/**
	 * Add or update a profile.
	 */
	async setProfile(profile: IProfile): Promise<IConfig> {
		const profiles = [...this.getProfiles()];
		const idx = profiles.findIndex((p) => p.id === profile.id);
		if (idx >= 0) {
			profiles[idx] = profile;
		} else {
			profiles.push(profile);
		}
		return await this.configStore.set({ profiles });
	}

	/**
	 * Delete a profile by ID.
	 */
	async deleteProfile(id: string): Promise<IConfig> {
		const profiles = this.getProfiles().filter((p) => p.id !== id);
		return await this.configStore.set({ profiles });
	}

	/**
	 * Toggle a profile's enabled state.
	 */
	async toggleProfile(id: string, enabled?: boolean): Promise<IConfig> {
		const profile = this.getProfile(id);
		if (!profile) return this.getConfig();
		const newEnabled = enabled ?? !profile.enabled;
		return await this.setProfile({ ...profile, enabled: newEnabled });
	}

	/**
	 * Reorder profiles by updating their priorities.
	 */
	async reorderProfiles(orderedIds: string[]): Promise<IConfig> {
		const profiles = [...this.getProfiles()];
		// Update priorities based on the new order
		for (let i = 0; i < orderedIds.length; i++) {
			const profile = profiles.find((p) => p.id === orderedIds[i]);
			if (profile) {
				profile.priority = i + 1;
			}
		}
		return await this.configStore.set({ profiles });
	}

	async addWatchDir(dir: string): Promise<IConfig> {
		if (!dir || dir.trim().length === 0) return this.getConfig();
		const resolved = this.normalizePath(dir);
		const cfg = this.getConfig();
		if (cfg.watchDirs.includes(resolved)) {
			if (cfg.watchDir !== resolved) {
				return await this.configStore.set({ watchDir: resolved });
			}
			return cfg;
		}
		const nextDirs = [...cfg.watchDirs, resolved];
		const primary = cfg.watchDir ?? resolved;
		return await this.configStore.set({ watchDirs: nextDirs, watchDir: primary });
	}

	async removeWatchDir(dir: string): Promise<IConfig> {
		if (!dir || dir.trim().length === 0) return this.getConfig();
		const resolved = this.normalizePath(dir);
		const cfg = this.getConfig();
		const remaining = cfg.watchDirs.filter((d) => d !== resolved);
		const next: Partial<IConfig> = { watchDirs: remaining };
		if (cfg.watchDir === resolved) next.watchDir = remaining[0];
		return await this.configStore.set(next);
	}

	async setPrimaryWatchDir(dir: string): Promise<IConfig> {
		if (!dir || dir.trim().length === 0) return this.getConfig();
		const resolved = this.normalizePath(dir);
		const cfg = this.getConfig();
		if (!cfg.watchDirs.includes(resolved)) {
			return await this.configStore.set({
				watchDir: resolved,
				watchDirs: [resolved, ...cfg.watchDirs],
			});
		}
		return await this.configStore.set({ watchDir: resolved });
	}

	async setWatchDirs(dirs: string[]): Promise<IConfig> {
		const normalized = this.normalizeDirs(dirs);
		if (!normalized.length) {
			return await this.configStore.set({ watchDirs: [] });
		}
		return await this.configStore.set({ watchDirs: normalized, watchDir: normalized[0] });
	}

	getConfig(): IConfig {
		if (!this.config) throw new Error('NamefixService not initialized');
		return this.config;
	}

	getStatus(): ServiceStatus {
		const cfg = this.getConfig();
		return {
			running: this.running,
			directories: this.getWatchDirs(cfg),
			dryRun: cfg.dryRun,
			launchOnLogin: cfg.launchOnLogin,
		};
	}

	async undoLast(): Promise<{ ok: boolean; reason?: string }> {
		const res = await this.journal.undo();
		if (res.ok) {
			this.emit('toast', { level: 'info', message: 'Undo applied' });
		} else {
			this.emit('toast', { level: 'error', message: res.reason || 'Undo failed' });
		}
		return res;
	}

	/**
	 * Subscribe to service events. Returns an unsubscribe handle for convenience.
	 */
	on<K extends keyof ServiceEventMap>(
		event: K,
		listener: (event: ServiceEventMap[K]) => void,
	): () => void {
		return this.emitter.on(event, listener);
	}

	private emit<K extends keyof ServiceEventMap>(event: K, payload: ServiceEventMap[K]) {
		this.emitter.emit(event, payload);
	}

	private async syncWatchers(): Promise<void> {
		await this.withWatcherLock(async () => {
			const cfg = this.getConfig();
			const desiredDirs = this.running ? this.getWatchDirs(cfg) : [];
			const desiredSet = new Set(desiredDirs);

			const stops: Array<Promise<void>> = [];
			for (const [dir, watcher] of this.watchers) {
				if (!desiredSet.has(dir)) {
					stops.push(this.stopWatcher(dir, watcher));
				}
			}
			if (stops.length) {
				const results = await Promise.allSettled(stops);
				// Log any failures
				for (const result of results) {
					if (result.status === 'rejected') {
						this.logger.error('Watcher stop failed', {
							error: result.reason instanceof Error ? result.reason.message : String(result.reason),
						});
					}
				}
			}

			if (!this.running || desiredDirs.length === 0) {
				if (!this.running) {
					this.logger.info('Watcher stopped');
				} else {
					this.logger.warn('No watch directories configured');
				}
				this.emitStatus();
				return;
			}

			for (const dir of desiredDirs) {
				if (this.watchers.has(dir)) continue;
				await this.startWatcher(dir);
			}
			this.emitStatus();
		});
	}

	private async startWatcher(dir: string): Promise<void> {
		await this.ensureDir(dir);
		const watcher = this.createWatcher(dir, this.fsSafe);

		// Register error handler if available
		if (typeof watcher.onError === 'function') {
			const unsubscribe = watcher.onError((error: Error, directory: string) => {
				this.logger.error('Watcher error', { directory, error: error.message });
				this.emit('toast', {
					level: 'warn',
					message: `Watcher issue for ${path.basename(directory)}: ${error.message}`,
				});
			});
			this.watcherErrorUnsubscribers.set(dir, unsubscribe);
		}

		this.watchers.set(dir, watcher);
		await watcher.start((ev) => {
			this.handleWatchEvent(dir, ev).catch((err) => {
				this.logger.error(err instanceof Error ? err : String(err));
			});
		});
	}

	private async stopWatcher(dir: string, watcher: IWatchService): Promise<void> {
		// Clean up error handler
		const unsubscribe = this.watcherErrorUnsubscribers.get(dir);
		if (unsubscribe) {
			unsubscribe();
			this.watcherErrorUnsubscribers.delete(dir);
		}

		try {
			if (typeof watcher.stop === 'function') {
				await watcher.stop();
			}
		} catch (err) {
			this.logger.error(err instanceof Error ? err : String(err));
		}

		try {
			await watcher.dispose();
		} catch (err) {
			this.logger.error(err instanceof Error ? err : String(err));
		} finally {
			this.watchers.delete(dir);
		}
	}

	private async withWatcherLock<T>(fn: () => Promise<T>): Promise<T> {
		const previous = this.watcherLock;
		let release: () => void = () => {};
		this.watcherLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await fn();
		} finally {
			release();
		}
	}

	private applyConfig(cfg: IConfig) {
		const normalizedDirs = this.normalizeDirs(cfg.watchDirs, cfg.watchDir);
		const primaryDir = normalizedDirs[0] ?? cfg.watchDir;
		this.config = {
			...cfg,
			watchDirs: normalizedDirs,
			watchDir: primaryDir,
		};
		// Initialize profile matcher if profiles exist
		if (cfg.profiles && cfg.profiles.length > 0) {
			this.profileMatcher = new ProfileMatcher(cfg.profiles);
		} else {
			this.profileMatcher = null;
		}
		// Legacy matcher for backwards compatibility
		this.matcher = new Matcher(cfg.include, cfg.exclude);
		this.emitStatus();
	}

	private async ensureDir(dir: string) {
		try {
			await fs.access(dir);
		} catch {
			await fs.mkdir(dir, { recursive: true });
		}
	}

	private getWatchDirs(cfg: IConfig): string[] {
		return this.normalizeDirs(cfg.watchDirs, cfg.watchDir);
	}

	private async handleWatchEvent(
		directory: string,
		ev: { path: string; birthtimeMs: number; mtimeMs: number; size: number },
	) {
		const cfg = this.getConfig();
		const basename = path.basename(ev.path);
		const extVal = path.extname(ev.path);
		const dir = path.dirname(ev.path);

		// Try profile-based matching first
		const matchedProfile = this.profileMatcher?.match(basename);

		if (matchedProfile) {
			// Profile-based renaming
			await this.handleProfileRename(directory, ev, basename, extVal, dir, matchedProfile, cfg);
		} else if (this.matcher?.test(basename)) {
			// Legacy fallback: use include/exclude patterns
			await this.handleLegacyRename(directory, ev, basename, extVal, dir, cfg);
		}
		// No match - file is ignored
	}

	private async handleProfileRename(
		directory: string,
		ev: { path: string; birthtimeMs: number; mtimeMs: number; size: number },
		basename: string,
		extVal: string,
		dir: string,
		profile: IProfile,
		cfg: IConfig,
	) {
		const action = profile.action ?? 'rename';

		if (action === 'convert') {
			await this.handleConvert(directory, ev, basename, extVal, dir, cfg);
			return;
		}

		if (action === 'rename+convert') {
			await this.handleRenameAndConvert(directory, ev, basename, extVal, dir, profile, cfg);
			return;
		}

		// action === 'rename' (default)
		await this.handleRenameOnly(directory, ev, basename, extVal, dir, profile, cfg);
	}

	private async handleConvert(
		directory: string,
		ev: { path: string; birthtimeMs: number; mtimeMs: number; size: number },
		basename: string,
		extVal: string,
		dir: string,
		cfg: IConfig,
	) {
		if (!this.converter.canConvert(extVal)) {
			this.emit('file', {
				kind: 'skipped',
				directory,
				file: basename,
				timestamp: Date.now(),
				message: 'unsupported format',
			});
			return;
		}

		if (cfg.dryRun) {
			const targetName = `${path.basename(basename, extVal)}.jpeg`;
			this.emit('file', {
				kind: 'preview',
				directory,
				file: basename,
				target: targetName,
				timestamp: Date.now(),
			});
			return;
		}

		try {
			const result = await this.converter.convert(ev.path, { outputFormat: 'jpeg' });
			const convertedBasename = path.basename(result.destPath);
			this.emit('file', {
				kind: 'converted',
				file: basename,
				target: convertedBasename,
				directory,
				timestamp: Date.now(),
				format: 'jpeg',
			});
			this.eventBus.emit('file:converted', {
				from: ev.path,
				to: result.destPath,
				format: 'jpeg',
			});
			await this.journal.record(ev.path, result.destPath);

			// Trash the original
			try {
				const trashResult = await this.trasher.moveToTrash(ev.path);
				if (trashResult.success) {
					this.emit('file', {
						kind: 'trashed',
						file: basename,
						directory,
						timestamp: Date.now(),
					});
					this.eventBus.emit('file:trashed', { path: ev.path });
				} else {
					this.emit('toast', {
						level: 'warn',
						message: `Could not trash original: ${trashResult.error}`,
					});
				}
			} catch {
				this.emit('toast', {
					level: 'warn',
					message: `Could not trash original: ${basename}`,
				});
			}
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			this.emit('file', {
				kind: 'convert-error',
				file: basename,
				directory,
				timestamp: Date.now(),
				message: error.message || 'conversion failed',
			});
		}
	}

	private async handleRenameAndConvert(
		directory: string,
		ev: { path: string; birthtimeMs: number; mtimeMs: number; size: number },
		basename: string,
		extVal: string,
		dir: string,
		profile: IProfile,
		cfg: IConfig,
	) {
		if (!this.converter.canConvert(extVal)) {
			this.emit('file', {
				kind: 'skipped',
				directory,
				file: basename,
				timestamp: Date.now(),
				message: 'unsupported format',
			});
			return;
		}

		if (cfg.dryRun) {
			const convertedName = `${path.basename(basename, extVal)}.jpeg`;
			this.emit('file', {
				kind: 'preview',
				directory,
				file: basename,
				target: convertedName,
				timestamp: Date.now(),
			});
			return;
		}

		try {
			// Step 1: Convert
			const result = await this.converter.convert(ev.path, { outputFormat: 'jpeg' });
			const convertedBasename = path.basename(result.destPath);
			this.emit('file', {
				kind: 'converted',
				file: basename,
				target: convertedBasename,
				directory,
				timestamp: Date.now(),
				format: 'jpeg',
			});
			this.eventBus.emit('file:converted', {
				from: ev.path,
				to: result.destPath,
				format: 'jpeg',
			});

			// Step 2: Rename the converted output
			const convertedExt = path.extname(result.destPath);
			const { filename: targetBase } = await this.renamer.targetForProfile(
				result.destPath,
				{ birthtime: new Date(ev.birthtimeMs), ext: convertedExt },
				profile,
			);
			const targetPath = path.join(dir, targetBase);

			try {
				await this.fsSafe.atomicRename(result.destPath, targetPath);
				await this.journal.record(ev.path, targetPath);
				this.emit('file', {
					kind: 'applied',
					directory,
					file: convertedBasename,
					target: targetBase,
					timestamp: Date.now(),
				});
			} catch (e: unknown) {
				const error = e instanceof Error ? e : new Error(String(e));
				this.logger.error(error);
				this.emit('file', {
					kind: 'error',
					directory,
					file: convertedBasename,
					timestamp: Date.now(),
					message: error.message || 'rename failed',
				});
			} finally {
				this.renamer.release(dir, targetBase);
			}

			// Step 3: Trash the original
			try {
				const trashResult = await this.trasher.moveToTrash(ev.path);
				if (trashResult.success) {
					this.emit('file', {
						kind: 'trashed',
						file: basename,
						directory,
						timestamp: Date.now(),
					});
					this.eventBus.emit('file:trashed', { path: ev.path });
				} else {
					this.emit('toast', {
						level: 'warn',
						message: `Could not trash original: ${trashResult.error}`,
					});
				}
			} catch {
				this.emit('toast', {
					level: 'warn',
					message: `Could not trash original: ${basename}`,
				});
			}
		} catch (e: unknown) {
			const error = e instanceof Error ? e : new Error(String(e));
			this.emit('file', {
				kind: 'convert-error',
				file: basename,
				directory,
				timestamp: Date.now(),
				message: error.message || 'conversion failed',
			});
		}
	}

	private async handleRenameOnly(
		directory: string,
		ev: { path: string; birthtimeMs: number; mtimeMs: number; size: number },
		basename: string,
		extVal: string,
		dir: string,
		profile: IProfile,
		cfg: IConfig,
	) {
		if (!this.renamer.needsRenameForProfile(basename, profile)) {
			this.emit('file', {
				kind: 'skipped',
				directory,
				file: basename,
				timestamp: Date.now(),
				message: 'idempotent',
			});
			return;
		}

		const { filename: targetBase } = await this.renamer.targetForProfile(
			ev.path,
			{ birthtime: new Date(ev.birthtimeMs), ext: extVal },
			profile,
		);
		const targetPath = path.join(dir, targetBase);

		try {
			if (cfg.dryRun) {
				this.emit('file', {
					kind: 'preview',
					directory,
					file: basename,
					target: targetBase,
					timestamp: Date.now(),
				});
				this.logger.info('preview', { from: ev.path, to: targetPath, profile: profile.name });
				return;
			}

			if (!(await pathExists(ev.path))) {
				let restored = false;
				for (let i = 0; i < 6; i++) {
					await delay(150);
					if (await pathExists(ev.path)) {
						restored = true;
						break;
					}
				}
				if (!restored) {
					this.logger.warn('source disappeared before rename', { path: ev.path });
					return;
				}
			}

			try {
				await this.fsSafe.atomicRename(ev.path, targetPath);
				await this.journal.record(ev.path, targetPath);
				this.emit('file', {
					kind: 'applied',
					directory,
					file: basename,
					target: targetBase,
					timestamp: Date.now(),
				});
				this.eventBus.emit('file:renamed', { from: ev.path, to: targetPath });
			} catch (e: unknown) {
				const error = e instanceof Error ? e : new Error(String(e));
				const message = error.message || 'rename failed';
				this.logger.error(error);
				this.emit('file', {
					kind: 'error',
					directory,
					file: basename,
					timestamp: Date.now(),
					message,
				});
				this.eventBus.emit('file:error', { path: ev.path, error });
			}
		} finally {
			this.renamer.release(dir, targetBase);
		}
	}

	private async handleLegacyRename(
		directory: string,
		ev: { path: string; birthtimeMs: number; mtimeMs: number; size: number },
		basename: string,
		extVal: string,
		dir: string,
		cfg: IConfig,
	) {
		if (!this.renamer.needsRename(basename, cfg.prefix)) {
			this.emit('file', {
				kind: 'skipped',
				directory,
				file: basename,
				timestamp: Date.now(),
				message: 'idempotent',
			});
			return;
		}

		const targetBase = await this.renamer.targetFor(ev.path, {
			birthtime: new Date(ev.birthtimeMs),
			ext: extVal,
			prefix: cfg.prefix,
		});
		const targetPath = path.join(dir, targetBase);

		try {
			if (cfg.dryRun) {
				this.emit('file', {
					kind: 'preview',
					directory,
					file: basename,
					target: targetBase,
					timestamp: Date.now(),
				});
				this.logger.info('preview', { from: ev.path, to: targetPath });
				return;
			}

			if (!(await pathExists(ev.path))) {
				let restored = false;
				for (let i = 0; i < 6; i++) {
					await delay(150);
					if (await pathExists(ev.path)) {
						restored = true;
						break;
					}
				}
				if (!restored) {
					this.logger.warn('source disappeared before rename', { path: ev.path });
					return;
				}
			}

			try {
				await this.fsSafe.atomicRename(ev.path, targetPath);
				await this.journal.record(ev.path, targetPath);
				this.emit('file', {
					kind: 'applied',
					directory,
					file: basename,
					target: targetBase,
					timestamp: Date.now(),
				});
				this.eventBus.emit('file:renamed', { from: ev.path, to: targetPath });
			} catch (e: unknown) {
				const error = e instanceof Error ? e : new Error(String(e));
				const message = error.message || 'rename failed';
				this.logger.error(error);
				this.emit('file', {
					kind: 'error',
					directory,
					file: basename,
					timestamp: Date.now(),
					message,
				});
				this.eventBus.emit('file:error', { path: ev.path, error });
			}
		} finally {
			this.renamer.release(dir, targetBase);
		}
	}

	private emitStatus() {
		if (!this.config) return;
		const dirs = this.getWatchDirs(this.config);
		this.emit('status', {
			running: this.running && this.watchers.size > 0,
			directories: dirs,
			dryRun: this.config.dryRun,
			launchOnLogin: this.config.launchOnLogin,
		});
	}

	private normalizeDirs(dirs?: (string | null | undefined)[], fallback?: string): string[] {
		const raw: string[] = [];
		if (Array.isArray(dirs)) {
			for (const entry of dirs) {
				if (entry && entry.trim().length > 0) {
					raw.push(entry);
				}
			}
		}
		if (!raw.length && fallback && fallback.trim().length > 0) {
			raw.push(fallback);
		}
		const normalized = raw
			.map((dir) => (dir ?? '').trim())
			.filter((dir) => dir.length > 0)
			.map((dir) => this.normalizePath(dir));
		return Array.from(new Set(normalized));
	}

	private normalizePath(dir: string): string {
		let d = dir.trim();
		if (d.startsWith('~/') || d === '~') {
			d = path.join(os.homedir(), d.slice(1));
		}
		return path.resolve(d);
	}

	// Health monitoring methods
	private startHealthMonitor(): void {
		this.stopHealthMonitor();
		this.healthCheckInterval = setInterval(() => {
			this.checkWatcherHealth().catch((err) => {
				this.logger.error(err instanceof Error ? err : String(err));
			});
		}, NamefixService.HEALTH_CHECK_INTERVAL_MS);
	}

	private stopHealthMonitor(): void {
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
			this.healthCheckInterval = null;
		}
	}

	private async checkWatcherHealth(): Promise<void> {
		if (!this.running) return;

		const unhealthyDirs: string[] = [];
		for (const [dir, watcher] of this.watchers) {
			// Check if watcher has isHealthy method
			if (typeof watcher.isHealthy === 'function') {
				if (!watcher.isHealthy()) {
					this.logger.warn('Watcher unhealthy', { dir });
					unhealthyDirs.push(dir);
					continue;
				}
			}

			// Also check if directory still exists
			try {
				await fs.access(dir);
			} catch {
				this.logger.warn('Watch directory no longer accessible', { dir });
				unhealthyDirs.push(dir);
			}
		}

		for (const dir of unhealthyDirs) {
			const attempts = this.watcherRestartAttempts.get(dir) ?? 0;
			if (attempts >= NamefixService.MAX_RESTART_ATTEMPTS) {
				this.logger.error('Max restart attempts reached for watcher', { dir, attempts });
				this.emit('toast', {
					level: 'error',
					message: `Watcher for ${path.basename(dir)} failed permanently. Please check directory.`,
				});
				continue;
			}

			this.watcherRestartAttempts.set(dir, attempts + 1);
			this.logger.warn('Restarting unhealthy watcher', { dir, attempt: attempts + 1 });

			const oldWatcher = this.watchers.get(dir);
			if (oldWatcher) {
				await this.stopWatcher(dir, oldWatcher);
			}

			try {
				await this.startWatcher(dir);
				// Reset attempts on successful restart
				this.watcherRestartAttempts.set(dir, 0);
				this.emit('toast', {
					level: 'info',
					message: `Watcher recovered for ${path.basename(dir)}`,
				});
				this.emitStatus();
			} catch (err) {
				this.logger.error('Failed to restart watcher', {
					dir,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
