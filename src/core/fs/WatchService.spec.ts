import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FsSafe } from './FsSafe.js';

const watchMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
	default: {
		watch: watchMock,
	},
}));

class FakeFsWatcher extends EventEmitter {
	close = vi.fn(() => {
		this.emit('close');
	});
}

describe('WatchService', () => {
	afterEach(() => {
		watchMock.mockReset();
		vi.restoreAllMocks();
	});

	it('ignores stale close events from a watcher replaced by restart', async () => {
		const { WatchService } = await import('./WatchService.js');
		const firstWatcher = new FakeFsWatcher();
		const secondWatcher = new FakeFsWatcher();
		watchMock.mockReturnValueOnce(firstWatcher).mockReturnValueOnce(secondWatcher);

		const service = new WatchService('/tmp/namefix-watch', {
			isStable: vi.fn(async () => true),
		} as unknown as FsSafe);

		await service.start(() => {});
		expect(service.isHealthy()).toBe(true);

		await service.start(() => {});
		expect(service.isHealthy()).toBe(true);

		firstWatcher.emit('close');

		expect(service.isHealthy()).toBe(true);
	});

	it('marks the active watcher unhealthy and notifies subscribed error handlers', async () => {
		const { WatchService } = await import('./WatchService.js');
		const watcher = new FakeFsWatcher();
		watchMock.mockReturnValueOnce(watcher);
		const service = new WatchService('/tmp/namefix-watch', {
			isStable: vi.fn(async () => true),
		} as unknown as FsSafe);
		const throwingHandler = vi.fn(() => {
			throw new Error('handler failed');
		});
		const handler = vi.fn();
		service.onError(throwingHandler);
		const unsubscribe = service.onError(handler);

		await service.start(() => {});
		watcher.emit('error', new Error('native watch failed'));
		unsubscribe();
		watcher.emit('error', new Error('after unsubscribe'));

		expect(service.isHealthy()).toBe(false);
		expect(throwingHandler).toHaveBeenCalledTimes(2);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'native watch failed' }),
			'/tmp/namefix-watch',
		);
	});

	it('ignores change events without actionable filenames', async () => {
		const { WatchService } = await import('./WatchService.js');
		const watcher = new FakeFsWatcher();
		const fsSafe = { isStable: vi.fn(async () => true) };
		watchMock.mockReturnValueOnce(watcher);
		const service = new WatchService('/tmp/namefix-watch', fsSafe as unknown as FsSafe);
		const onAdd = vi.fn();

		await service.start(onAdd);
		watcher.emit('change', 'rename', null);
		watcher.emit('change', 'rename', '.partial.png');
		watcher.emit('close');
		watcher.emit('change', 'rename', 'ignored.png');

		expect(fsSafe.isStable).not.toHaveBeenCalled();
		expect(onAdd).not.toHaveBeenCalled();
	});

	it('suppresses duplicate pending changes and emits stable file events', async () => {
		const { WatchService } = await import('./WatchService.js');
		const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'namefix-watchservice-'));
		const file = path.join(dir, 'capture.png');
		await fsp.writeFile(file, 'image');
		vi.spyOn(fsp, 'stat').mockResolvedValue({
			isFile: () => true,
			birthtimeMs: 100,
			mtimeMs: 200,
			size: 5,
		} as Awaited<ReturnType<typeof fsp.stat>>);
		const watcher = new FakeFsWatcher();
		let releaseStable: () => void = () => {};
		const stablePromise = new Promise<boolean>((resolve) => {
			releaseStable = () => resolve(true);
		});
		const fsSafe = { isStable: vi.fn(() => stablePromise) };
		watchMock.mockReturnValueOnce(watcher);
		const service = new WatchService(dir, fsSafe as unknown as FsSafe);
		const onAdd = vi.fn();

		await service.start(onAdd);
		watcher.emit('change', 'rename', Buffer.from('capture.png'));
		watcher.emit('change', 'rename', 'capture.png');
		await vi.waitFor(() => {
			expect(fsSafe.isStable).toHaveBeenCalledTimes(1);
		});
		releaseStable();

		await vi.waitFor(() => {
			expect(onAdd).toHaveBeenCalledTimes(1);
		});
		expect(onAdd.mock.calls[0]?.[0]).toMatchObject({
			path: file,
			size: 5,
		});
		await fsp.rm(dir, { recursive: true, force: true });
	});

	it('reports non-ENOENT processing errors to handlers', async () => {
		const { WatchService } = await import('./WatchService.js');
		const watcher = new FakeFsWatcher();
		watchMock.mockReturnValueOnce(watcher);
		vi.spyOn(fsp, 'stat').mockRejectedValue(
			Object.assign(new Error('permission denied'), { code: 'EACCES' }),
		);
		const service = new WatchService('/tmp/namefix-watch', {
			isStable: vi.fn(async () => true),
		} as unknown as FsSafe);
		const handler = vi.fn();
		service.onError(handler);

		await service.start(() => {});
		watcher.emit('change', 'rename', 'blocked.png');

		await vi.waitFor(() => {
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'permission denied' }),
				'/tmp/namefix-watch',
			);
		});
	});

	it('clears handlers and closes the watcher on dispose', async () => {
		const { WatchService } = await import('./WatchService.js');
		const watcher = new FakeFsWatcher();
		watchMock.mockReturnValueOnce(watcher);
		const service = new WatchService('/tmp/namefix-watch', {
			isStable: vi.fn(async () => true),
		} as unknown as FsSafe);
		const handler = vi.fn();
		service.onError(handler);

		await service.start(() => {});
		await service.dispose();
		watcher.emit('error', new Error('after dispose'));

		expect(watcher.close).toHaveBeenCalledTimes(1);
		expect(service.isHealthy()).toBe(false);
		expect(handler).not.toHaveBeenCalled();
	});
});
