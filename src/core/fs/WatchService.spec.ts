import { EventEmitter } from 'node:events';
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
});
