import chokidar from 'chokidar';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FsSafe } from './FsSafe.js';
import type { IWatchService, WatchEvent, WatchServiceErrorHandler } from '../../types/index';

export class WatchService implements IWatchService {
	private watcher: chokidar.FSWatcher | null = null;
	private healthy = false;
	private errorHandlers = new Set<WatchServiceErrorHandler>();
	private static readonly INIT_TIMEOUT_MS = 60_000;

	constructor(
		private readonly dir: string,
		private readonly fsSafe: FsSafe,
	) {}

	async start(onAdd: (event: WatchEvent) => void): Promise<void> {
		this.stopCurrent();

		return new Promise((resolve, reject) => {
			let resolved = false;
			const timeout = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					reject(new Error(`Watcher initialization timed out for ${this.dir}`));
				}
			}, WatchService.INIT_TIMEOUT_MS);

			this.watcher = chokidar.watch(this.dir, {
				ignoreInitial: true,
				depth: 0,
				awaitWriteFinish: false,
				persistent: true,
				ignored: (p) => path.basename(p).startsWith('.'),
			});

			this.watcher.on('ready', () => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timeout);
					this.healthy = true;
					resolve();
				}
			});

			this.watcher.on('error', (error: Error) => {
				this.healthy = false;
				// Emit to all registered handlers
				for (const handler of this.errorHandlers) {
					try {
						handler(error, this.dir);
					} catch {
						// Don't let handler errors propagate
					}
				}
				// If still initializing, reject the promise
				if (!resolved) {
					resolved = true;
					clearTimeout(timeout);
					reject(error);
				}
			});

			this.watcher.on('add', async (full) => {
				if (!this.healthy) return;
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
					// File disappeared or other transient error - handle gracefully
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
			});
		});
	}

	async stop(): Promise<void> {
		if (!this.watcher) return;
		this.healthy = false;
		try {
			await this.watcher.close();
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
