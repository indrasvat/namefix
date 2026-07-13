import { describe, expect, it, vi } from 'vitest';
import { TypedEmitter } from './TypedEmitter.js';

type Events = {
	status: { running: boolean };
	toast: { message: string };
};

describe('TypedEmitter', () => {
	it('subscribes, unsubscribes, and removes listeners', () => {
		const emitter = new TypedEmitter<Events>();
		const status = vi.fn();
		const toast = vi.fn();

		const off = emitter.on('status', status);
		emitter.on('toast', toast);
		emitter.emit('status', { running: true });
		off();
		emitter.emit('status', { running: false });
		emitter.emit('toast', { message: 'hello' });
		emitter.removeAllListeners();
		emitter.emit('toast', { message: 'ignored' });

		expect(status).toHaveBeenCalledTimes(1);
		expect(status).toHaveBeenCalledWith({ running: true });
		expect(toast).toHaveBeenCalledTimes(1);
	});

	it('supports one-shot listeners', () => {
		const emitter = new TypedEmitter<Events>();
		const listener = vi.fn();

		emitter.once('status', listener);
		emitter.emit('status', { running: true });
		emitter.emit('status', { running: false });

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({ running: true });
	});
});
