import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FsSafe } from './FsSafe.js';
import type { IWatchService, WatchEvent, WatchServiceErrorHandler } from '../../types/index';

export class WatchService implements IWatchService {
	private watcher: fs.FSWatcher | null = null;
	private healthy = false;
	private errorHandlers = new Set<WatchServiceErrorHandler>();
	private pending = new Set<string>();

	constructor(
		private readonly dir: string,
		private readonly fsSafe: FsSafe,
	) {}

	async start(onAdd: (event: WatchEvent) => void): Promise<void> {
		this.stopCurrent();

		this.watcher = fs.watch(this.dir, { persistent: true, recursive: false });

		this.watcher.on('error', (error: Error) => {
			this.healthy = false;
			for (const handler of this.errorHandlers) {
				try {
					handler(error, this.dir);
				} catch {
					// Don't let handler errors propagate
				}
			}
		});

		this.watcher.on('change', (_eventType, filename) => {
			if (!this.healthy || !filename) return;
			const name = typeof filename === 'string' ? filename : filename.toString();
			if (name.startsWith('.')) return;
			const full = path.join(this.dir, name);
			if (this.pending.has(full)) return;
			this.pending.add(full);
			this.handleNewFile(full, onAdd).finally(() => this.pending.delete(full));
		});

		this.healthy = true;
	}

	private async handleNewFile(
		full: string,
		onAdd: (event: WatchEvent) => void,
	): Promise<void> {
		try {
			const st = await fsp.stat(full);
			if (!st.isFile()) return;
			const stable = await this.fsSafe.isStable(full);
			if (!stable) return;
			onAdd({
				path: full,
				birthtimeMs: st.birthtimeMs,
				mtimeMs: st.mtimeMs,
				size: st.size,
			});
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			const code = (err as NodeJS.ErrnoException).code;
			// ENOENT is expected for files that disappear during processing
			if (code !== 'ENOENT') {
				for (const handler of this.errorHandlers) {
					try {
						handler(err, this.dir);
					} catch {
						// Ignore handler errors
					}
				}
			}
		}
	}

	async stop(): Promise<void> {
		if (!this.watcher) return;
		this.healthy = false;
		try {
			this.watcher.close();
		} finally {
			this.watcher = null;
		}
	}

	private stopCurrent() {
		if (this.watcher) {
			this.healthy = false;
			try {
				this.watcher.close();
			} catch {
				// Ignore close errors
			}
			this.watcher = null;
		}
	}

	isHealthy(): boolean {
		return this.healthy && this.watcher !== null;
	}

	onError(handler: WatchServiceErrorHandler): () => void {
		this.errorHandlers.add(handler);
		return () => this.errorHandlers.delete(handler);
	}

	dispose(): void | Promise<void> {
		this.errorHandlers.clear();
		return this.stop();
	}
}
