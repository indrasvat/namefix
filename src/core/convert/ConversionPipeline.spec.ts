import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type {
	IConfig,
	IConfigStore,
	IWatchService,
	WatchEvent,
	ILogger,
} from '../../types/index.js';
import type { ServiceFileEvent, ServiceToastEvent } from '../../types/service.js';
import { NamefixService } from '../NamefixService.js';
import type { ConversionService } from './ConversionService.js';
import type { TrashService } from './TrashService.js';

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

describe('ConversionPipeline integration', () => {
	let tempRoot: string;
	let watchDir: string;
	let configStore: MemoryConfigStore;
	const watchers = new Map<string, StubWatcher>();
	let mockConverter: { convert: ReturnType<typeof vi.fn>; canConvert: ReturnType<typeof vi.fn> };
	let mockTrasher: { moveToTrash: ReturnType<typeof vi.fn> };

	function heicConvertConfig(dir: string, overrides: Partial<IConfig> = {}): IConfig {
		return {
			watchDir: dir,
			watchDirs: [dir],
			prefix: '',
			include: [],
			exclude: [],
			dryRun: false,
			theme: 'default',
			launchOnLogin: false,
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
			...overrides,
		};
	}

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'namefix-pipeline-'));
		watchDir = await fs.mkdtemp(path.join(tempRoot, 'watch-'));
		process.env.NAMEFIX_HOME = path.join(tempRoot, 'config');
		process.env.NAMEFIX_LOGS = path.join(tempRoot, 'logs');
		watchers.clear();
		mockConverter = { convert: vi.fn(), canConvert: vi.fn().mockReturnValue(true) };
		mockTrasher = { moveToTrash: vi.fn().mockResolvedValue({ srcPath: '', success: true }) };
	});

	afterEach(async () => {
		process.env.NAMEFIX_HOME = undefined;
		process.env.NAMEFIX_LOGS = undefined;
		await fs.rm(tempRoot, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	function createService(cfg: IConfig) {
		configStore = new MemoryConfigStore(cfg);
		return new NamefixService({
			configStore,
			logger: noopLogger,
			converter: mockConverter as unknown as ConversionService,
			trasher: mockTrasher as unknown as TrashService,
			watcherFactory: (dir) => {
				const watcher = new StubWatcher();
				watchers.set(dir, watcher);
				return watcher;
			},
		});
	}

	function firstWatcher(): StubWatcher {
		const watcher = watchers.values().next().value;
		if (!watcher) throw new Error('no watcher');
		return watcher;
	}

	async function triggerFile(watcher: StubWatcher, dir: string, filename: string): Promise<void> {
		const srcPath = path.join(dir, filename);
		await fs.writeFile(srcPath, 'fake-data');
		watcher.trigger({
			path: srcPath,
			birthtimeMs: Date.now(),
			mtimeMs: Date.now(),
			size: 100,
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	it('HEIC file triggers conversion pipeline', async () => {
		const srcPath = path.join(watchDir, 'IMG_1234.heic');
		mockConverter.convert.mockResolvedValue({
			srcPath,
			destPath: path.join(watchDir, 'IMG_1234.jpeg'),
			format: 'jpeg',
			durationMs: 10,
		});

		const service = createService(heicConvertConfig(watchDir));
		await service.init();
		await service.start();

		const fileEvents: ServiceFileEvent[] = [];
		service.on('file', (event) => fileEvents.push(event));

		const watcher = firstWatcher();
		await triggerFile(watcher, watchDir, 'IMG_1234.heic');

		expect(mockConverter.canConvert).toHaveBeenCalledWith('.heic');
		expect(mockConverter.convert).toHaveBeenCalledWith(srcPath, { outputFormat: 'jpeg' });
		expect(mockTrasher.moveToTrash).toHaveBeenCalledWith(srcPath);

		const converted = fileEvents.find((e) => e.kind === 'converted');
		expect(converted).toBeDefined();
		expect(converted).toMatchObject({
			kind: 'converted',
			file: 'IMG_1234.heic',
			target: 'IMG_1234.jpeg',
			format: 'jpeg',
		});

		const trashed = fileEvents.find((e) => e.kind === 'trashed');
		expect(trashed).toBeDefined();
		expect(trashed).toMatchObject({
			kind: 'trashed',
			file: 'IMG_1234.heic',
		});
	});

	it('non-convertible file with convert action is skipped', async () => {
		// Use a wildcard profile so the file matches, but canConvert returns false
		const cfg = heicConvertConfig(watchDir, {
			profiles: [
				{
					id: 'all-convert',
					name: 'Convert all',
					enabled: true,
					pattern: '*',
					isRegex: false,
					template: '<original>',
					prefix: '',
					priority: 0,
					action: 'convert' as const,
				},
			],
		});
		mockConverter.canConvert.mockReturnValue(false);

		const service = createService(cfg);
		await service.init();
		await service.start();

		const fileEvents: ServiceFileEvent[] = [];
		service.on('file', (event) => fileEvents.push(event));

		const watcher = firstWatcher();
		await triggerFile(watcher, watchDir, 'video.mp4');

		expect(mockConverter.convert).not.toHaveBeenCalled();

		const skipped = fileEvents.find((e) => e.kind === 'skipped');
		expect(skipped).toBeDefined();
		expect(skipped).toMatchObject({ kind: 'skipped', file: 'video.mp4' });
	});

	it('dry-run mode emits preview without converting', async () => {
		const service = createService(heicConvertConfig(watchDir, { dryRun: true }));
		await service.init();
		await service.start();

		const fileEvents: ServiceFileEvent[] = [];
		service.on('file', (event) => fileEvents.push(event));

		const watcher = firstWatcher();
		await triggerFile(watcher, watchDir, 'IMG_1234.heic');

		expect(mockConverter.convert).not.toHaveBeenCalled();

		const preview = fileEvents.find((e) => e.kind === 'preview');
		expect(preview).toBeDefined();
		if (preview?.kind === 'preview') {
			expect(preview.target).toBe('IMG_1234.jpeg');
		}
	});

	it('conversion failure emits convert-error event', async () => {
		mockConverter.convert.mockRejectedValue(new Error('sips failed'));

		const service = createService(heicConvertConfig(watchDir));
		await service.init();
		await service.start();

		const fileEvents: ServiceFileEvent[] = [];
		service.on('file', (event) => fileEvents.push(event));

		const watcher = firstWatcher();
		await triggerFile(watcher, watchDir, 'IMG_1234.heic');

		const errEvent = fileEvents.find((e) => e.kind === 'convert-error');
		expect(errEvent).toBeDefined();
		if (errEvent?.kind === 'convert-error') {
			expect(errEvent.message).toBe('sips failed');
		}
	});

	it('trash failure after conversion emits toast warning', async () => {
		const srcPath = path.join(watchDir, 'IMG_1234.heic');
		mockConverter.convert.mockResolvedValue({
			srcPath,
			destPath: path.join(watchDir, 'IMG_1234.jpeg'),
			format: 'jpeg',
			durationMs: 10,
		});
		mockTrasher.moveToTrash.mockResolvedValue({
			srcPath,
			success: false,
			error: 'permission denied',
		});

		const service = createService(heicConvertConfig(watchDir));
		await service.init();
		await service.start();

		const fileEvents: ServiceFileEvent[] = [];
		const toastEvents: ServiceToastEvent[] = [];
		service.on('file', (event) => fileEvents.push(event));
		service.on('toast', (event) => toastEvents.push(event));

		const watcher = firstWatcher();
		await triggerFile(watcher, watchDir, 'IMG_1234.heic');

		// Conversion succeeded
		const converted = fileEvents.find((e) => e.kind === 'converted');
		expect(converted).toBeDefined();

		// No trashed event
		const trashed = fileEvents.find((e) => e.kind === 'trashed');
		expect(trashed).toBeUndefined();

		// Toast warning emitted
		const warning = toastEvents.find((e) => e.level === 'warn');
		expect(warning).toBeDefined();
		expect(warning?.message).toContain('Could not trash original');
	});

	it('rename+convert action converts then renames', async () => {
		const srcPath = path.join(watchDir, 'IMG_1234.heic');
		const convertedPath = path.join(watchDir, 'IMG_1234.jpeg');

		mockConverter.convert.mockImplementation(async () => {
			// Simulate sips creating the converted output on disk
			await fs.writeFile(convertedPath, 'fake-jpeg-data');
			return {
				srcPath,
				destPath: convertedPath,
				format: 'jpeg',
				durationMs: 10,
			};
		});

		const cfg = heicConvertConfig(watchDir, {
			profiles: [
				{
					id: 'heic-rename-convert',
					name: 'HEIC convert+rename',
					enabled: true,
					pattern: '*.heic',
					isRegex: false,
					template: '<prefix>_<datetime>',
					prefix: 'Photo',
					priority: 0,
					action: 'rename+convert' as const,
				},
			],
		});

		const service = createService(cfg);
		await service.init();
		await service.start();

		const fileEvents: ServiceFileEvent[] = [];
		service.on('file', (event) => fileEvents.push(event));

		const watcher = firstWatcher();
		await triggerFile(watcher, watchDir, 'IMG_1234.heic');

		// Step 1: Conversion happened
		expect(mockConverter.convert).toHaveBeenCalledWith(srcPath, { outputFormat: 'jpeg' });
		const converted = fileEvents.find((e) => e.kind === 'converted');
		expect(converted).toBeDefined();

		// Step 2: Rename applied to converted file
		const applied = fileEvents.find((e) => e.kind === 'applied');
		expect(applied).toBeDefined();
		if (applied?.kind === 'applied') {
			// The renamed file should use the converted file as source
			expect(applied.file).toBe('IMG_1234.jpeg');
			// Target should follow the template pattern
			expect(applied.target).toMatch(/^Photo_/);
		}

		// Step 3: Original trashed
		const trashed = fileEvents.find((e) => e.kind === 'trashed');
		expect(trashed).toBeDefined();
	});
});
