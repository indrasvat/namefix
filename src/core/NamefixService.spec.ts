import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { IConfig, IConfigStore, IWatchService, WatchEvent, ILogger } from '../types/index.js';
import type { ServiceStatus, ServiceFileEvent, ServiceToastEvent } from '../types/service.js';
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
		this.handler = handler;
	});
	readonly stop = vi.fn(async () => {
		this.stopped = true;
	});
	readonly dispose = vi.fn(async () => {
		this.disposed = true;
	});
	handler: ((event: WatchEvent) => void) | null = null;
	stopped = false;
	disposed = false;

	trigger(event: WatchEvent) {
		this.handler?.(event);
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
	let createdDirs: string[] = [];
	let mockConverter: { convert: ReturnType<typeof vi.fn>; canConvert: ReturnType<typeof vi.fn> };
	let mockTrasher: { moveToTrash: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'namefix-service-'));
		process.env.NAMEFIX_HOME = path.join(tempRoot, 'config');
		process.env.NAMEFIX_LOGS = path.join(tempRoot, 'logs');
		watchers.clear();
		createdDirs = [];
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
				watchers.set(dir, watcher);
				createdDirs.push(dir);
				return watcher;
			},
		});
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
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(previousWatcher.stop).toHaveBeenCalledTimes(1);
		expect(previousWatcher.dispose).toHaveBeenCalledTimes(1);
		expect(createdDirs.filter((dir) => dir === newDir).length).toBe(1);
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

		await new Promise((resolve) => setTimeout(resolve, 25));
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

		await new Promise((resolve) => setTimeout(resolve, 25));
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

			await new Promise((resolve) => setTimeout(resolve, 50));

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

			await new Promise((resolve) => setTimeout(resolve, 25));
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

			await new Promise((resolve) => setTimeout(resolve, 50));

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

			await new Promise((resolve) => setTimeout(resolve, 50));

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
