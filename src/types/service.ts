import type { IConfig } from './index.js';

export type ServiceStatus = {
	running: boolean;
	directories: string[];
	dryRun: boolean;
	launchOnLogin: boolean;
};

export type ServiceFileEvent =
	| { kind: 'preview'; file: string; target: string; directory: string; timestamp: number }
	| { kind: 'applied'; file: string; target: string; directory: string; timestamp: number }
	| { kind: 'skipped'; file: string; directory: string; timestamp: number; message?: string }
	| { kind: 'error'; file: string; directory: string; timestamp: number; message: string };

export type ServiceToastEvent = { message: string; level: 'info' | 'warn' | 'error' };

export type ServiceEventMap = {
	file: ServiceFileEvent;
	status: ServiceStatus;
	config: IConfig;
	toast: ServiceToastEvent;
};

export type ServiceEventKey = keyof ServiceEventMap;

export interface IServiceEventStream {
	on<K extends ServiceEventKey>(
		event: K,
		listener: (payload: ServiceEventMap[K]) => void,
	): () => void;
	emit<K extends ServiceEventKey>(event: K, payload: ServiceEventMap[K]): void;
}
