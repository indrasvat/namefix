import fscb from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IJournalStore } from '../../types/index';
import { stateDir } from '../../utils/paths.js';
import type { FsSafe } from '../fs/FsSafe.js';

type Entry = { from: string; to: string; ts: number };

function journalDir() {
	return stateDir('namefix');
}

function journalPath() {
	return path.join(journalDir(), 'journal.ndjson');
}

export class JournalStore implements IJournalStore {
	private cache: Entry[] = [];
	private loaded = false;
	private rewritePending = false;
	private operationLock: Promise<void> = Promise.resolve();

	constructor(
		private readonly fsSafe: FsSafe,
		private readonly maxEntries = 1_000,
	) {
		if (!Number.isInteger(maxEntries) || maxEntries < 1) {
			throw new Error('maxEntries must be a positive integer');
		}
	}

	private async ensure() {
		await fs.mkdir(journalDir(), { recursive: true });
	}

	private async load(): Promise<Entry[]> {
		await this.ensure();
		try {
			const data = await fs.readFile(journalPath(), 'utf8');
			const lines = data.split(/\r?\n/).filter(Boolean);
			this.cache = lines.map((l) => JSON.parse(l)).slice(-this.maxEntries);
			if (lines.length > this.maxEntries) {
				await this.rewrite(this.cache);
			}
		} catch (e: unknown) {
			if (isNodeError(e) && e.code !== 'ENOENT') {
				throw e;
			}
			this.cache = [];
		}
		this.loaded = true;
		return this.cache;
	}

	async record(from: string, to: string): Promise<void> {
		await this.withLock(async () => {
			if (!this.loaded) await this.load();
			await this.flushPendingRewrite();
			const entry: Entry = { from, to, ts: Date.now() };
			await fs.appendFile(journalPath(), `${JSON.stringify(entry)}\n`, 'utf8');
			this.cache.push(entry);
			if (this.cache.length > this.maxEntries) {
				const retained = this.cache.slice(-this.maxEntries);
				await this.rewrite(retained);
				this.cache = retained;
			}
		});
	}

	async undo(): Promise<{ ok: boolean; reason?: string }> {
		return await this.withLock(async () => this.undoUnlocked());
	}

	private async undoUnlocked(): Promise<{ ok: boolean; reason?: string }> {
		if (!this.loaded) await this.load();
		try {
			await this.flushPendingRewrite();
		} catch (e: unknown) {
			return { ok: false, reason: e instanceof Error ? e.message : 'journal_rewrite_failed' };
		}
		const last = this.cache.pop();
		if (!last) return { ok: false, reason: 'empty' };
		try {
			const target = await this.restoreTarget(last);
			await this.fsSafe.atomicRename(last.to, target);
		} catch (e: unknown) {
			this.cache.push(last);
			const reason = e instanceof Error ? e.message : 'rename_failed';
			return { ok: false, reason };
		}
		try {
			await this.rewrite();
		} catch {
			// The filesystem operation already succeeded. Keep the entry consumed in memory
			// and repair the durable journal before the next operation.
			this.rewritePending = true;
		}
		return { ok: true };
	}

	private async flushPendingRewrite(): Promise<void> {
		if (!this.rewritePending) return;
		await this.rewrite();
		this.rewritePending = false;
	}

	private async withLock<T>(fn: () => Promise<T>): Promise<T> {
		const previous = this.operationLock;
		let release: () => void = () => {};
		this.operationLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await fn();
		} finally {
			release();
		}
	}

	private async restoreTarget(entry: Entry): Promise<string> {
		// If original is free, use it; else add _restored suffix
		const exists = await existsSafe(entry.from);
		if (!exists) return entry.from;
		const dir = path.dirname(entry.from);
		const ext = path.extname(entry.from);
		const base = path.basename(entry.from, ext);
		let n = 1;
		let candidate = path.join(dir, `${base}_restored${ext}`);
		while (await existsSafe(candidate)) {
			n++;
			candidate = path.join(dir, `${base}_restored_${n}${ext}`);
		}
		return candidate;
	}

	private async rewrite(entries: Entry[] = this.cache) {
		const tmp = `${journalPath()}.tmp`;
		const data = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
		await fs.writeFile(tmp, data, 'utf8');
		await fs.rename(tmp, journalPath());
	}

	dispose(): void | Promise<void> {
		// nothing
	}
}

async function existsSafe(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === 'object' && err !== null && 'code' in err;
}
