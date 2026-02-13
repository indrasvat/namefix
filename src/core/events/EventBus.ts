import { EventEmitter } from 'node:events';

type Events = {
	'file:added': { path: string; birthtimeMs: number; mtimeMs: number; size: number };
	'file:renamed': { from: string; to: string };
	'file:converted': { from: string; to: string; format: string };
	'file:trashed': { path: string };
	'file:error': { path: string; error: Error };
	'journal:undone': { from: string; to: string; ok: boolean };
	'ui:toast': { level: 'info' | 'warn' | 'error'; message: string };
	'config:changed': { key?: string };
};

export class EventBus {
	private emitter = new EventEmitter({ captureRejections: true });

	on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void) {
		this.emitter.on(event, listener);
		return () => this.emitter.off(event, listener);
	}

	once<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void) {
		this.emitter.once(event, listener);
	}

	emit<K extends keyof Events>(event: K, payload: Events[K]) {
		this.emitter.emit(event, payload);
	}

	removeAll() {
		this.emitter.removeAllListeners();
	}
}
