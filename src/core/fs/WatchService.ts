import chokidar from 'chokidar';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FsSafe } from './FsSafe.js';
import type { IWatchService, WatchEvent } from '../../types/index';

export class WatchService implements IWatchService {
	private watcher: chokidar.FSWatcher | null = null;

	constructor(
		private readonly dir: string,
		private readonly fsSafe: FsSafe,
	) {}

	async start(onAdd: (event: WatchEvent) => void): Promise<void> {
		this.stopCurrent();
		this.watcher = chokidar.watch(this.dir, {
			ignoreInitial: true,
			depth: 0,
			awaitWriteFinish: false,
			persistent: true,
			ignored: (p) => path.basename(p).startsWith('.'),
		});

		this.watcher.on('add', async (full) => {
			try {
				const st = await fsp.stat(full);
				if (!st.isFile()) return;
				const stable = await this.fsSafe.isStable(full);
				if (!stable) return;
				onAdd({ path: full, birthtimeMs: st.birthtimeMs, mtimeMs: st.mtimeMs, size: st.size });
			} catch {
				// ignore
			}
		});
	}

	async stop(): Promise<void> {
		if (!this.watcher) return;
		try {
			await this.watcher.close();
		} finally {
			this.watcher = null;
		}
	}

	private stopCurrent() {
		if (this.watcher) {
			try {
				this.watcher.close();
			} catch {}
			this.watcher = null;
		}
	}

	dispose(): void | Promise<void> {
		return this.stop();
	}
}
