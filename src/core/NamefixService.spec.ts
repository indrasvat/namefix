import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfig, IConfigStore, ILogger, IWatchService, WatchEvent } from '../types/index.js';
import type { ServiceFileEvent, ServiceStatus, ServiceToastEvent } from '../types/service.js';
import { delay } from '../utils/async.js';
import { NamefixService } from './NamefixService.js';
import type { ConversionService } from './convert/ConversionService.js';
import type { TrashService } from './convert/TrashService.js';

class MemoryConfigStore implements IConfigStore {
	private cfg: IConfig;
	private listeners = new Set<(config: IConfig) => void>();

	constructor(initial: IConfig) {
		this.cfg = {
			...initial,
			watchDirs: [...initial.watchDirs],
			include: [...initial.include],
			exclude: [...initial.exclude],
			profiles: [...(initial.profiles ?? [])],
		};
	}

	async get(): Promise<IConfig> {
		return this.clone();
	}

	async set(next: Partial<IConfig>): Promise<IConfig> {
		if (next.watchDirs) {
			this.cfg.watchDirs = [...next.watchDirs];
			if (!next.watchDir && this.cfg.watchDirs.length > 0) {
				this.cfg.watchDir = this.cfg.watchDirs[0] ?? '';
			}
		}
		if (next.profiles) {
			this.cfg.profiles = [...next.profiles];
		}
		this.cfg = { ...this.cfg, ...next };
		if (!this.cfg.watchDir && this.cfg.watchDirs.length > 0) {
			this.cfg.watchDir = this.cfg.watchDirs[0] ?? '';
		}
		const snapshot = this.clone();
		for (const cb of this.listeners) {
			cb(snapshot);
		}
		return snapshot;
	}

	onChange(cb: (config: IConfig) => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	private clone(): IConfig {
		return {
			...this.cfg,
			watchDirs: [...this.cfg.watchDirs],
			include: [...this.cfg.include],
			exclude: [...this.cfg.exclude],
			profiles: [...this.cfg.profiles],
		};
	}
}

class StubWatcher implements IWatchService {
	readonly start = vi.fn(async (handler: (event: WatchEvent) => void) => {
		if (this.startError) {
			throw this.startError;
		}
		this.handler = handler;
		this.healthy = true;
	});
	readonly stop = vi.fn(async () => {
		this.stopped = true;
	});
	readonly dispose = vi.fn(async () => {
		this.disposed = true;
	});
	handler: ((event: WatchEvent) => void) | null = null;
	private errorHandlers = new Set<(error: Error, directory: string) => void>();
	stopped = false;
	disposed = false;
	healthy = true;
	startError: Error | null = null;

	trigger(event: WatchEvent) {
		this.handler?.(event);
	}

	emitError(error: Error, directory: string) {
		this.healthy = false;
		for (const handler of this.errorHandlers) {
			handler(error, directory);
		}
	}

	isHealthy(): boolean {
		return this.healthy;
	}

	onError(handler: (error: Error, directory: string) => void): () => void {
		this.errorHandlers.add(handler);
		return () => this.errorHandlers.delete(handler);
	}
}

const noopLogger: ILogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
};

const baseConfig = (): IConfig => ({
	watchDir: '',
	watchDirs: [],
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
});

describe('NamefixService', () => {
	let tempRoot: string;
	let configStore: MemoryConfigStore;
	const watchers = new Map<string, StubWatcher>();
	let createdWatchers: StubWatcher[] = [];
	let createdDirs: string[] = [];
	let configureWatcher: ((watcher: StubWatcher, dir: string) => void) | null = null;
	let mockConverter: { convert: ReturnType<typeof vi.fn>; canConvert: ReturnType<typeof vi.fn> };
	let mockTrasher: { moveToTrash: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'namefix-service-'));
		process.env.NAMEFIX_HOME = path.join(tempRoot, 'config');
		process.env.NAMEFIX_LOGS = path.join(tempRoot, 'logs');
		watchers.clear();
		createdWatchers = [];
		createdDirs = [];
		configureWatcher = null;
		mockConverter = { convert: vi.fn(), canConvert: vi.fn().mockReturnValue(true) };
		mockTrasher = { moveToTrash: vi.fn().mockResolvedValue({ srcPath: '', success: true }) };
		const dirA = await fs.mkdtemp(path.join(tempRoot, 'watch-a-'));
		const dirB = await fs.mkdtemp(path.join(tempRoot, 'watch-b-'));
		configStore = new MemoryConfigStore({
			...baseConfig(),
			watchDir: dirA,
			watchDirs: [dirA, dirB],
		});
	});

	afterEach(async () => {
		process.env.NAMEFIX_HOME = undefined;
		process.env.NAMEFIX_LOGS = undefined;
		await fs.rm(tempRoot, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	function createService() {
		return new NamefixService({
			configStore,
			logger: noopLogger,
			converter: mockConverter as unknown as ConversionService,
			trasher: mockTrasher as unknown as TrashService,
			watcherFactory: (dir) => {
				const watcher = new StubWatcher();
				configureWatcher?.(watcher, dir);
				watchers.set(dir, watcher);
				createdWatchers.push(watcher);
				createdDirs.push(dir);
				return watcher;
			},
		});
	}

	function serviceWatchers(service: NamefixService): Map<string, StubWatcher> {
		return (
			service as unknown as {
				watchers: Map<string, StubWatcher>;
			}
		).watchers;
	}

	it('starts watchers for all configured directories and emits running status', async () => {
		const service = createService();
		const initialConfig = await configStore.get();
		const statuses: ServiceStatus[] = [];
		service.on('status', (status) => statuses.push(status));

		await service.init();
		await service.start();

		expect(watchers.size).toBe(2);
		for (const watcher of watchers.values()) {
			expect(watcher.start).toHaveBeenCalledTimes(1);
		}
		expect(statuses.pop()).toMatchObject({
			running: true,
			directories: initialConfig.watchDirs,
			dryRun: initialConfig.dryRun,
			launchOnLogin: initialConfig.launchOnLogin,
		});
	});

	it('synchronises watchers when directories change', async () => {
		const service = createService();
		await service.init();
		await service.start();

		const baselineStatus = service.getStatus();
		const [firstDir] = Array.from(watchers.keys());
		expect(firstDir).toBeDefined();
		if (!firstDir) {
			throw new Error('Expected watcher directory to be defined');
		}
		const previousWatcher = watchers.get(firstDir);
		if (!previousWatcher) {
			throw new Error('Expected watcher to exist');
		}

		const newDir = await fs.mkdtemp(path.join(tempRoot, 'watch-c-'));
		const statusUpdates: ServiceStatus[] = [];
		service.on('status', (status) => statusUpdates.push(status));

		await service.setWatchDirs([newDir]);
		await vi.waitFor(() => {
			expect(createdDirs.filter((dir) => dir === newDir).length).toBe(1);
		});

		expect(previousWatcher.stop).toHaveBeenCalledTimes(1);
		expect(previousWatcher.dispose).toHaveBeenCalledTimes(1);
		const newWatcher = watchers.get(newDir);
		if (newWatcher) {
			expect(newWatcher.start).toHaveBeenCalledTimes(1);
		}
		expect(statusUpdates.pop()).toMatchObject({
			directories: [newDir],
			running: true,
			launchOnLogin: baselineStatus.launchOnLogin,
		});
	});

	it('forwards file events through the service emitter', async () => {
		const service = createService();
		await service.init();
		await service.start();

		const dir = Array.from(watchers.keys())[0];
		expect(dir).toBeDefined();
		if (!dir) {
			throw new Error('Expected watcher directory to be defined');
		}
		const watcher = watchers.get(dir);
		if (!watcher) {
			throw new Error('Expected watcher to exist');
		}

		const events: ServiceFileEvent[] = [];
		service.on('file', (event) => events.push(event));

		watcher.trigger({
			path: path.join(dir, 'Screenshot 2025-10-30 at 09.00.00.png'),
			birthtimeMs: Date.now(),
			mtimeMs: Date.now(),
			size: 10,
		});

		await vi.waitFor(() => {
			expect(events).toHaveLength(1);
		});
		expect(events).toHaveLength(1);
		expect(events.at(0)?.kind).toBe('preview');
	});

	it('stops watchers when service stops', async () => {
		const service = createService();
		await service.init();
		await service.start();

		await service.stop();

		for (const watcher of watchers.values()) {
			expect(watcher.stop).toHaveBeenCalled();
			expect(watcher.dispose).toHaveBeenCalled();
		}
	});

	it('toggles running state and persists simple boolean settings', async () => {
		const service = createService();
		const statuses: ServiceStatus[] = [];
		await service.init();
		service.on('status', (status) => statuses.push(status));

		await service.toggleRunning();
		expect(service.getStatus().running).toBe(true);
		await expect(service.setDryRun(false)).resolves.toMatchObject({ dryRun: false });
		await expect(service.setLaunchOnLogin(true)).resolves.toMatchObject({ launchOnLogin: true });
		await service.toggleRunning();

		expect(service.getStatus()).toMatchObject({
			running: false,
			dryRun: false,
			launchOnLogin: true,
		});
		expect(statuses.some((status) => status.running)).toBe(true);
		expect(statuses.at(-1)?.running).toBe(false);
	});

	it('manages profiles by add, update, toggle, reorder, and delete', async () => {
		const service = createService();
		await service.init();
		const baseProfile = service.getProfile('screenshots');
		expect(baseProfile).toBeDefined();
		if (!baseProfile) throw new Error('profile missing');

		const customProfile = {
			...baseProfile,
			id: 'client-captures',
			name: 'Client Captures',
			pattern: 'Client*',
			priority: 5,
		};

		await service.setProfile(customProfile);
		expect(service.getProfile('client-captures')?.pattern).toBe('Client*');
		await service.setProfile({ ...customProfile, pattern: 'Client Capture*' });
		expect(service.getProfile('client-captures')?.pattern).toBe('Client Capture*');
		await service.toggleProfile('client-captures', false);
		expect(service.getProfile('client-captures')?.enabled).toBe(false);
		await service.toggleProfile('missing-profile', true);
		await service.reorderProfiles(['client-captures', 'screenshots']);
		expect(service.getProfile('client-captures')?.priority).toBe(1);
		expect(service.getProfile('screenshots')?.priority).toBe(2);
		await service.deleteProfile('client-captures');
		expect(service.getProfile('client-captures')).toBeUndefined();
	});

	it('normalizes watch directory edits and preserves primary directory rules', async () => {
		const service = createService();
		await service.init();
		const initial = service.getConfig();
		const first = initial.watchDirs[0];
		const second = initial.watchDirs[1];
		if (!first || !second) throw new Error('expected two watch dirs');

		await service.addWatchDir('   ');
		expect(service.getConfig().watchDirs).toEqual(initial.watchDirs);
		await service.addWatchDir(second);
		expect(service.getConfig().watchDir).toBe(second);

		const homeRelative = '~/Namefix Tests';
		await service.setPrimaryWatchDir(homeRelative);
		const homeResolved = path.resolve(os.homedir(), 'Namefix Tests');
		expect(service.getConfig().watchDir).toBe(homeResolved);
		expect(service.getConfig().watchDirs[0]).toBe(homeResolved);

		await service.removeWatchDir(homeResolved);
		expect(service.getConfig().watchDir).toBe(second);
		await service.setWatchDirs([first, first, ' ', second]);
		expect(service.getConfig().watchDirs).toEqual([first, second]);
	});

	it('starts cleanly with no watch directories and reports a paused watcher set', async () => {
		configStore = new MemoryConfigStore({ ...baseConfig(), watchDir: '', watchDirs: [] });
		const service = createService();
		await service.init();
		const statuses: ServiceStatus[] = [];
		service.on('status', (status) => statuses.push(status));

		await service.start();

		expect(watchers.size).toBe(0);
		expect(statuses.at(-1)).toMatchObject({ running: true, directories: [] });
		expect(noopLogger.warn).toHaveBeenCalledWith('No watch directories configured');
	});

	it('logs cleanup failures but still removes watchers on stop', async () => {
		const service = createService();
		await service.init();
		await service.start();

		const firstWatcher = createdWatchers[0];
		if (!firstWatcher) throw new Error('watcher missing');
		firstWatcher.stop.mockRejectedValueOnce(new Error('stop failed'));
		firstWatcher.dispose.mockRejectedValueOnce(new Error('dispose failed'));

		await service.stop();

		expect(serviceWatchers(service).has(createdDirs[0] ?? '')).toBe(false);
		expect(noopLogger.error).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'stop failed' }),
		);
		expect(noopLogger.error).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'dispose failed' }),
		);
	});

	it('emits a warning and cleans up when watcher startup fails', async () => {
		const cfg = await configStore.get();
		const onlyDir = cfg.watchDirs[0];
		if (!onlyDir) throw new Error('watch dir missing');
		configStore = new MemoryConfigStore({ ...cfg, watchDir: onlyDir, watchDirs: [onlyDir] });
		configureWatcher = (watcher) => {
			watcher.startError = new Error('too many open files');
		};
		const service = createService();
		const toasts: ServiceToastEvent[] = [];
		await service.init();
		service.on('toast', (event) => toasts.push(event));

		await service.start();

		expect(serviceWatchers(service).has(onlyDir)).toBe(false);
		expect(createdWatchers[0]?.stop).toHaveBeenCalledTimes(1);
		expect(toasts).toContainEqual({
			level: 'warn',
			message: `Could not watch ${path.basename(onlyDir)}`,
		});
	});

	it('falls back to legacy include/exclude matching when profiles are absent', async () => {
		const cfg = await configStore.get();
		const onlyDir = cfg.watchDirs[0];
		if (!onlyDir) throw new Error('watch dir missing');
		configStore = new MemoryConfigStore({
			...cfg,
			watchDir: onlyDir,
			watchDirs: [onlyDir],
			profiles: [],
			include: ['Legacy*'],
			exclude: ['*skip*'],
			dryRun: true,
		});
		const service = createService();
		const events: ServiceFileEvent[] = [];
		await service.init();
		await service.start();
		service.on('file', (event) => events.push(event));
		const watcher = watchers.get(onlyDir);
		if (!watcher) throw new Error('watcher missing');

		watcher.trigger({
			path: path.join(onlyDir, 'Legacy Capture.png'),
			birthtimeMs: new Date(2026, 6, 13, 10, 11, 12).getTime(),
			mtimeMs: Date.now(),
			size: 20,
		});
		watcher.trigger({
			path: path.join(onlyDir, 'Legacy skip.png'),
			birthtimeMs: Date.now(),
			mtimeMs: Date.now(),
			size: 20,
		});

		await vi.waitFor(() => {
			expect(events).toHaveLength(1);
		});
		expect(events[0]).toMatchObject({
			kind: 'preview',
			file: 'Legacy Capture.png',
		});
	});

	it('logs health monitor errors without crashing the interval', async () => {
		vi.useFakeTimers();
		const service = createService();
		await service.init();
		const checkWatcherHealth = vi
			.spyOn(
				service as unknown as {
					checkWatcherHealth(): Promise<void>;
				},
				'checkWatcherHealth',
			)
			.mockRejectedValue(new Error('health check failed'));

		(
			service as unknown as {
				startHealthMonitor(): void;
				stopHealthMonitor(): void;
			}
		).startHealthMonitor();
		await vi.advanceTimersByTimeAsync(30_000);
		(
			service as unknown as {
				stopHealthMonitor(): void;
			}
		).stopHealthMonitor();
		vi.useRealTimers();

		expect(checkWatcherHealth).toHaveBeenCalledTimes(1);
		expect(noopLogger.error).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'health check failed' }),
		);
	});

	it('replaces a watcher immediately after it reports an error', async () => {
		const service = createService();
		await service.init();
		await service.start();

		const dir = Array.from(watchers.keys())[0];
		expect(dir).toBeDefined();
		if (!dir) throw new Error('dir missing');
		const failedWatcher = watchers.get(dir);
		expect(failedWatcher).toBeDefined();
		if (!failedWatcher) throw new Error('watcher missing');

		const toasts: ServiceToastEvent[] = [];
		service.on('toast', (event) => toasts.push(event));

		failedWatcher.emitError(new Error('fsevents stream closed'), dir);
		await vi.waitFor(() => {
			expect(createdWatchers.length).toBe(3);
		});

		const replacement = watchers.get(dir);
		expect(replacement).toBeDefined();
		expect(replacement).not.toBe(failedWatcher);
		expect(failedWatcher.stop).toHaveBeenCalledTimes(1);
		expect(failedWatcher.dispose).toHaveBeenCalledTimes(1);
		expect(replacement?.start).toHaveBeenCalledTimes(1);
		expect(toasts.some((event) => event.message.includes('Watcher recovered'))).toBe(true);
	});

	describe('watcher recovery state machine', () => {
		async function checkWatcherHealth(service: NamefixService) {
			await (
				service as unknown as {
					checkWatcherHealth(): Promise<void>;
				}
			).checkWatcherHealth();
		}

		function activeWatchers(service: NamefixService): Map<string, StubWatcher> {
			return (
				service as unknown as {
					watchers: Map<string, StubWatcher>;
				}
			).watchers;
		}

		function firstStartedWatcher(): { dir: string; watcher: StubWatcher } {
			const dir = Array.from(watchers.keys())[0];
			if (!dir) throw new Error('dir missing');
			const watcher = watchers.get(dir);
			if (!watcher) throw new Error('watcher missing');
			return { dir, watcher };
		}

		async function restartAttempts(service: NamefixService): Promise<Map<string, number>> {
			return (
				service as unknown as {
					watcherRestartAttempts: Map<string, number>;
				}
			).watcherRestartAttempts;
		}

		it('ignores stale error callbacks from a watcher that has already been replaced', async () => {
			const service = createService();
			await service.init();
			await service.start();

			const { dir, watcher: original } = firstStartedWatcher();
			original.emitError(new Error('stream closed'), dir);
			await vi.waitFor(() => {
				expect(createdWatchers.length).toBe(3);
			});

			const replacement = watchers.get(dir);
			expect(replacement).toBeDefined();
			original.emitError(new Error('late native callback'), dir);
			await delay(25);

			expect(createdWatchers.length).toBe(3);
			expect(watchers.get(dir)).toBe(replacement);
		});

		it('coalesces duplicate error callbacks from the same failed watcher', async () => {
			const service = createService();
			await service.init();
			await service.start();

			const { dir, watcher: original } = firstStartedWatcher();
			original.emitError(new Error('first stream error'), dir);
			original.emitError(new Error('duplicate stream error'), dir);

			await vi.waitFor(() => {
				expect(createdWatchers.length).toBe(3);
			});
			await delay(25);

			const replacement = activeWatchers(service).get(dir);
			expect(replacement).toBeDefined();
			expect(replacement).not.toBe(original);
			expect(original.stop).toHaveBeenCalledTimes(1);
			expect(createdWatchers.length).toBe(3);
		});

		it('recovers a desired directory that has no live watcher after a failed restart', async () => {
			let failNextRestart = true;
			configureWatcher = (watcher) => {
				if (createdWatchers.length >= 2 && failNextRestart) {
					failNextRestart = false;
					watcher.startError = new Error('watch descriptor exhausted');
				}
			};

			const service = createService();
			await service.init();
			await service.start();

			const { dir, watcher: original } = firstStartedWatcher();
			original.emitError(new Error('fsevents stream closed'), dir);

			await vi.waitFor(() => {
				expect(createdWatchers.length).toBe(3);
			});
			expect(original.stop).toHaveBeenCalledTimes(1);
			expect(activeWatchers(service).has(dir)).toBe(false);

			await checkWatcherHealth(service);

			const replacement = activeWatchers(service).get(dir);
			expect(replacement).toBeDefined();
			expect(replacement).not.toBe(original);
			expect(replacement?.start).toHaveBeenCalledTimes(1);
		});

		it('resets restart attempts after a later recovery succeeds', async () => {
			let failNextRestart = true;
			configureWatcher = (watcher) => {
				if (createdWatchers.length >= 2 && failNextRestart) {
					failNextRestart = false;
					watcher.startError = new Error('temporary watch descriptor exhaustion');
				}
			};

			const service = createService();
			await service.init();
			await service.start();

			const { dir, watcher: original } = firstStartedWatcher();
			original.emitError(new Error('fsevents stream closed'), dir);

			await vi.waitFor(() => {
				expect(activeWatchers(service).has(dir)).toBe(false);
			});
			expect((await restartAttempts(service)).get(dir)).toBe(1);

			await checkWatcherHealth(service);

			expect(activeWatchers(service).has(dir)).toBe(true);
			expect((await restartAttempts(service)).get(dir)).toBe(2);

			await checkWatcherHealth(service);

			expect((await restartAttempts(service)).get(dir)).toBe(0);
		});

		it('bounds watchers that repeatedly open and immediately report errors', async () => {
			const service = createService();
			await service.init();
			await service.start();

			const toasts: ServiceToastEvent[] = [];
			service.on('toast', (event) => toasts.push(event));

			const { dir, watcher: original } = firstStartedWatcher();
			original.emitError(new Error('stream closed 1'), dir);
			await vi.waitFor(() => {
				expect(createdWatchers.length).toBe(3);
			});

			activeWatchers(service).get(dir)?.emitError(new Error('stream closed 2'), dir);
			await vi.waitFor(() => {
				expect(createdWatchers.length).toBe(4);
			});

			activeWatchers(service).get(dir)?.emitError(new Error('stream closed 3'), dir);
			await vi.waitFor(() => {
				expect(createdWatchers.length).toBe(5);
			});

			activeWatchers(service).get(dir)?.emitError(new Error('stream closed 4'), dir);
			await vi.waitFor(() => {
				expect(toasts.some((event) => event.level === 'error')).toBe(true);
			});

			expect(activeWatchers(service).get(dir)).toBe(createdWatchers.at(-1));
			expect(createdWatchers.length).toBe(5);
			expect((await restartAttempts(service)).get(dir)).toBe(3);
		});

		it('does not recreate a directory removed from config while recovery is pending', async () => {
			const service = createService();
			await service.init();
			await service.start();

			const { dir, watcher } = firstStartedWatcher();
			await service.removeWatchDir(dir);

			watcher.emitError(new Error('late error after config removal'), dir);
			await checkWatcherHealth(service);

			expect(activeWatchers(service).has(dir)).toBe(false);
			expect(createdDirs.filter((createdDir) => createdDir === dir)).toHaveLength(1);
		});

		it('does not restart a watcher after the service has stopped', async () => {
			const service = createService();
			await service.init();
			await service.start();

			const { dir, watcher } = firstStartedWatcher();
			await service.stop();

			watcher.emitError(new Error('late close after stop'), dir);
			await checkWatcherHealth(service);

			expect(createdWatchers.length).toBe(2);
			expect(activeWatchers(service).has(dir)).toBe(false);
		});

		it('emits a degraded status after repeated restart failures', async () => {
			configureWatcher = (watcher) => {
				if (createdWatchers.length >= 2) {
					watcher.startError = new Error('watch descriptor exhausted');
				}
			};

			const service = createService();
			await service.init();
			await service.start();

			const toasts: ServiceToastEvent[] = [];
			service.on('toast', (event) => toasts.push(event));

			const { dir, watcher } = firstStartedWatcher();
			watcher.emitError(new Error('fsevents stream closed'), dir);

			await vi.waitFor(() => {
				expect(activeWatchers(service).has(dir)).toBe(false);
			});
			await checkWatcherHealth(service);
			await checkWatcherHealth(service);
			await checkWatcherHealth(service);

			expect(activeWatchers(service).has(dir)).toBe(false);
			expect(
				toasts.some((event) => event.level === 'error' && event.message.includes('is degraded')),
			).toBe(true);
		});

		it('reports degraded directories and retries after the recovery cooldown', async () => {
			let startsFail = true;
			configureWatcher = (watcher) => {
				if (createdWatchers.length >= 2 && startsFail) {
					watcher.startError = new Error('watch descriptor exhausted');
				}
			};

			const service = createService();
			await service.init();
			await service.start();
			const { dir, watcher } = firstStartedWatcher();
			watcher.emitError(new Error('fsevents stream closed'), dir);

			await vi.waitFor(() => expect(activeWatchers(service).has(dir)).toBe(false));
			await checkWatcherHealth(service);
			await checkWatcherHealth(service);
			await checkWatcherHealth(service);

			expect(service.getStatus().degradedDirectories).toContain(dir);

			startsFail = false;
			(service as unknown as { watcherRetryAfter: Map<string, number> }).watcherRetryAfter.set(
				dir,
				Date.now() - 1,
			);
			await checkWatcherHealth(service);

			expect(activeWatchers(service).has(dir)).toBe(true);
			expect(service.getStatus().degradedDirectories).not.toContain(dir);
		});
	});

	it('profile with action: rename (or missing) triggers rename only', async () => {
		const service = createService();
		await service.init();
		await service.start();

		const dir = Array.from(watchers.keys())[0];
		expect(dir).toBeDefined();
		if (!dir) throw new Error('dir missing');
		const watcher = watchers.get(dir);
		expect(watcher).toBeDefined();
		if (!watcher) throw new Error('watcher missing');

		const events: ServiceFileEvent[] = [];
		service.on('file', (event) => events.push(event));

		// Profile has no action field — should default to rename behavior
		watcher.trigger({
			path: path.join(dir, 'Screenshot 2025-10-30 at 09.00.00.png'),
			birthtimeMs: Date.now(),
			mtimeMs: Date.now(),
			size: 10,
		});

		await vi.waitFor(() => {
			expect(events).toHaveLength(1);
		});
		expect(events).toHaveLength(1);
		expect(events[0]?.kind).toBe('preview');
		expect(mockConverter.convert).not.toHaveBeenCalled();
	});

	describe('convert action', () => {
		function createConvertConfig(dir: string, dryRun = false): IConfig {
			return {
				...baseConfig(),
				watchDir: dir,
				watchDirs: [dir],
				dryRun,
				profiles: [
					{
						id: 'heic-convert',
						name: 'HEIC to JPEG',
						enabled: true,
						pattern: '*.heic',
						isRegex: false,
						template: '<original>',
						prefix: '',
						priority: 0,
						action: 'convert' as const,
					},
				],
			};
		}

		function firstWatcher(): { dir: string; watcher: StubWatcher } {
			const dir = Array.from(watchers.keys())[0];
			if (!dir) throw new Error('no watcher dir');
			const watcher = watchers.get(dir);
			if (!watcher) throw new Error('no watcher');
			return { dir, watcher };
		}

		async function getFirstDir(): Promise<string> {
			const cfg = await configStore.get();
			const d = cfg.watchDirs[0];
			if (!d) throw new Error('no watchDirs');
			return d;
		}

		it('profile with action: convert triggers conversion (not rename)', async () => {
			const dirA = await getFirstDir();
			configStore = new MemoryConfigStore(createConvertConfig(dirA, false));

			const srcPath = path.join(dirA, 'IMG_1234.heic');
			await fs.writeFile(srcPath, 'fake-heic-data');

			mockConverter.convert.mockResolvedValue({
				srcPath,
				destPath: path.join(dirA, 'IMG_1234.jpeg'),
				format: 'jpeg',
				durationMs: 10,
			});

			const service = createService();
			await service.init();
			await service.start();

			const { watcher } = firstWatcher();
			const events: ServiceFileEvent[] = [];
			service.on('file', (event) => events.push(event));

			watcher.trigger({
				path: srcPath,
				birthtimeMs: Date.now(),
				mtimeMs: Date.now(),
				size: 100,
			});

			await vi.waitFor(() => {
				expect(events.some((e) => e.kind === 'trashed')).toBe(true);
			});

			expect(mockConverter.convert).toHaveBeenCalledWith(srcPath, { outputFormat: 'jpeg' });
			const converted = events.find((e) => e.kind === 'converted');
			expect(converted).toBeDefined();
			expect(converted).toMatchObject({
				kind: 'converted',
				file: 'IMG_1234.heic',
				target: 'IMG_1234.jpeg',
				format: 'jpeg',
			});
			const trashed = events.find((e) => e.kind === 'trashed');
			expect(trashed).toBeDefined();
		});

		it('profile with action: convert in dry-run emits preview event', async () => {
			const dirA = await getFirstDir();
			configStore = new MemoryConfigStore(createConvertConfig(dirA, true));

			const service = createService();
			await service.init();
			await service.start();

			const { dir, watcher } = firstWatcher();
			const events: ServiceFileEvent[] = [];
			service.on('file', (event) => events.push(event));

			watcher.trigger({
				path: path.join(dir, 'IMG_1234.heic'),
				birthtimeMs: Date.now(),
				mtimeMs: Date.now(),
				size: 100,
			});

			await vi.waitFor(() => {
				expect(events).toHaveLength(1);
			});
			expect(events).toHaveLength(1);
			const ev = events[0];
			expect(ev?.kind).toBe('preview');
			if (ev?.kind === 'preview') {
				expect(ev.target).toBe('IMG_1234.jpeg');
			}
			expect(mockConverter.convert).not.toHaveBeenCalled();
		});

		it('conversion failure emits convert-error event', async () => {
			const dirA = await getFirstDir();
			configStore = new MemoryConfigStore(createConvertConfig(dirA, false));

			const srcPath = path.join(dirA, 'IMG_bad.heic');
			await fs.writeFile(srcPath, 'fake-heic-data');

			mockConverter.convert.mockRejectedValue(new Error('sips failed'));

			const service = createService();
			await service.init();
			await service.start();

			const { watcher } = firstWatcher();
			const events: ServiceFileEvent[] = [];
			service.on('file', (event) => events.push(event));

			watcher.trigger({
				path: srcPath,
				birthtimeMs: Date.now(),
				mtimeMs: Date.now(),
				size: 100,
			});

			await vi.waitFor(() => {
				expect(events).toHaveLength(1);
			});

			expect(events).toHaveLength(1);
			const ev = events[0];
			expect(ev?.kind).toBe('convert-error');
			if (ev?.kind === 'convert-error') {
				expect(ev.message).toBe('sips failed');
			}
		});

		it('trash failure after conversion emits toast warning but conversion event still fires', async () => {
			const dirA = await getFirstDir();
			configStore = new MemoryConfigStore(createConvertConfig(dirA, false));

			const srcPath = path.join(dirA, 'IMG_trash.heic');
			await fs.writeFile(srcPath, 'fake-heic-data');

			mockConverter.convert.mockResolvedValue({
				srcPath,
				destPath: path.join(dirA, 'IMG_trash.jpeg'),
				format: 'jpeg',
				durationMs: 10,
			});
			mockTrasher.moveToTrash.mockResolvedValue({
				srcPath,
				success: false,
				error: 'permission denied',
			});

			const service = createService();
			await service.init();
			await service.start();

			const { watcher } = firstWatcher();
			const fileEvents: ServiceFileEvent[] = [];
			const toastEvents: ServiceToastEvent[] = [];
			service.on('file', (event) => fileEvents.push(event));
			service.on('toast', (event) => toastEvents.push(event));

			watcher.trigger({
				path: srcPath,
				birthtimeMs: Date.now(),
				mtimeMs: Date.now(),
				size: 100,
			});

			await vi.waitFor(() => {
				expect(toastEvents.some((e) => e.level === 'warn')).toBe(true);
			});

			const converted = fileEvents.find((e) => e.kind === 'converted');
			expect(converted).toBeDefined();
			const trashed = fileEvents.find((e) => e.kind === 'trashed');
			expect(trashed).toBeUndefined();
			const warning = toastEvents.find((e) => e.level === 'warn');
			expect(warning).toBeDefined();
			expect(warning?.message).toContain('Could not trash original');
		});
	});
});
