import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FsSafe } from '../fs/FsSafe.js';
import { JournalStore } from './JournalStore.js';

describe('JournalStore', () => {
	let tempRoot: string;
	let fsSafe: FsSafe;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'namefix-journal-'));
		process.env.XDG_STATE_HOME = path.join(tempRoot, 'state');
		fsSafe = new FsSafe();
	});

	afterEach(async () => {
		process.env.XDG_STATE_HOME = undefined;
		await fs.rm(tempRoot, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it('records durable rename history and restores the most recent entry', async () => {
		const from = path.join(tempRoot, 'Screenshot 1.png');
		const to = path.join(tempRoot, 'Screenshot_2026-01-02_03-04-05.png');
		await fs.writeFile(to, 'renamed');

		const store = new JournalStore(fsSafe);
		await store.record(from, to);

		const freshStore = new JournalStore(fsSafe);
		await expect(freshStore.undo()).resolves.toEqual({ ok: true });
		await expect(fs.readFile(from, 'utf8')).resolves.toBe('renamed');
		await expect(fs.access(to)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('keeps older history when the newest undo succeeds', async () => {
		const firstFrom = path.join(tempRoot, 'first.png');
		const firstTo = path.join(tempRoot, 'first-renamed.png');
		const secondFrom = path.join(tempRoot, 'second.png');
		const secondTo = path.join(tempRoot, 'second-renamed.png');
		await fs.writeFile(firstTo, 'first');
		await fs.writeFile(secondTo, 'second');

		const store = new JournalStore(fsSafe);
		await store.record(firstFrom, firstTo);
		await store.record(secondFrom, secondTo);

		await expect(store.undo()).resolves.toEqual({ ok: true });
		await expect(store.undo()).resolves.toEqual({ ok: true });
		await expect(fs.readFile(firstFrom, 'utf8')).resolves.toBe('first');
		await expect(fs.readFile(secondFrom, 'utf8')).resolves.toBe('second');
	});

	it('uses restored suffixes instead of overwriting an existing original file', async () => {
		const from = path.join(tempRoot, 'Screenshot 1.png');
		const to = path.join(tempRoot, 'Screenshot_2026-01-02_03-04-05.png');
		const restored = path.join(tempRoot, 'Screenshot 1_restored.png');
		await fs.writeFile(from, 'existing');
		await fs.writeFile(restored, 'existing restored');
		await fs.writeFile(to, 'renamed');

		const store = new JournalStore(fsSafe);
		await store.record(from, to);

		await expect(store.undo()).resolves.toEqual({ ok: true });
		await expect(
			fs.readFile(path.join(tempRoot, 'Screenshot 1_restored_2.png'), 'utf8'),
		).resolves.toBe('renamed');
		await expect(fs.readFile(from, 'utf8')).resolves.toBe('existing');
	});

	it('returns a failure reason and preserves history when restore rename fails', async () => {
		const from = path.join(tempRoot, 'Screenshot 1.png');
		const to = path.join(tempRoot, 'Screenshot_2026-01-02_03-04-05.png');
		await fs.writeFile(to, 'renamed');
		const atomicRename = vi.spyOn(fsSafe, 'atomicRename').mockRejectedValue(new Error('locked'));

		const store = new JournalStore(fsSafe);
		await store.record(from, to);

		await expect(store.undo()).resolves.toEqual({ ok: false, reason: 'locked' });
		expect(atomicRename).toHaveBeenCalledWith(to, from);
		atomicRename.mockRestore();
		await expect(store.undo()).resolves.toEqual({ ok: true });
	});

	it('reports empty when no journal entries exist', async () => {
		const store = new JournalStore(fsSafe);
		await expect(store.undo()).resolves.toEqual({ ok: false, reason: 'empty' });
	});
});
