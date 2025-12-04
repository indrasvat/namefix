import { EventEmitter } from 'node:events';

type Listener<T> = (payload: T) => void;

export class TypedEmitter<Events extends Record<string, unknown>> {
	private emitter = new EventEmitter({ captureRejections: true });

	on<K extends keyof Events & string>(event: K, listener: Listener<Events[K]>): () => void {
		this.emitter.on(event, listener as (...args: unknown[]) => void);
		return () => this.off(event, listener);
	}

	once<K extends keyof Events & string>(event: K, listener: Listener<Events[K]>): void {
		this.emitter.once(event, listener as (...args: unknown[]) => void);
	}

	off<K extends keyof Events & string>(event: K, listener: Listener<Events[K]>): void {
		this.emitter.off(event, listener as (...args: unknown[]) => void);
	}

	emit<K extends keyof Events & string>(event: K, payload: Events[K]): void {
		this.emitter.emit(event, payload);
	}

	removeAllListeners(): void {
		this.emitter.removeAllListeners();
	}
}
