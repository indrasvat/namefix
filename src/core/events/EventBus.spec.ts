import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './EventBus.js';

describe('EventBus', () => {
	it('should register a listener and receive a payload with on()', () => {
		const bus = new EventBus();
		const listener = vi.fn();
		const payload = { path: 'test.png', birthtimeMs: 123, mtimeMs: 456, size: 789 };

		bus.on('file:added', listener);
		bus.emit('file:added', payload);

		expect(listener).toHaveBeenCalledWith(payload);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('should return an unsubscribe function from on()', () => {
		const bus = new EventBus();
		const listener = vi.fn();
		const payload = { path: 'test.png', birthtimeMs: 123, mtimeMs: 456, size: 789 };

		const unsubscribe = bus.on('file:added', listener);
		unsubscribe();
		bus.emit('file:added', payload);

		expect(listener).not.toHaveBeenCalled();
	});

	it('should register a listener and receive a payload only once with once()', () => {
		const bus = new EventBus();
		const listener = vi.fn();
		const payload = { path: 'test.png', birthtimeMs: 123, mtimeMs: 456, size: 789 };

		bus.once('file:added', listener);
		bus.emit('file:added', payload);
		bus.emit('file:added', payload);

		expect(listener).toHaveBeenCalledWith(payload);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('should remove all listeners with removeAll()', () => {
		const bus = new EventBus();
		const listener1 = vi.fn();
		const listener2 = vi.fn();
		const payload = { key: 'test' };

		bus.on('config:changed', listener1);
		bus.on('config:changed', listener2);
		bus.removeAll();
		bus.emit('config:changed', payload);

		expect(listener1).not.toHaveBeenCalled();
		expect(listener2).not.toHaveBeenCalled();
	});

	it('should correctly handle different event types', () => {
		const bus = new EventBus();
		const fileAddedListener = vi.fn();
		const configChangedListener = vi.fn();
		const fileAddedPayload = { path: 'test.png', birthtimeMs: 123, mtimeMs: 456, size: 789 };
		const configChangedPayload = { key: 'theme' };

		bus.on('file:added', fileAddedListener);
		bus.on('config:changed', configChangedListener);

		bus.emit('file:added', fileAddedPayload);
		expect(fileAddedListener).toHaveBeenCalledWith(fileAddedPayload);
		expect(configChangedListener).not.toHaveBeenCalled();

		bus.emit('config:changed', configChangedPayload);
		expect(configChangedListener).toHaveBeenCalledWith(configChangedPayload);
	});
});
