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

	it('does not restore a consumed entry when journal rewrite fails after undo', async () => {
		const from = path.join(tempRoot, 'Screenshot 1.png');
		const to = path.join(tempRoot, 'Screenshot_renamed.png');
		await fs.writeFile(to, 'renamed');
		const atomicRename = vi.spyOn(fsSafe, 'atomicRename').mockResolvedValue();

		const store = new JournalStore(fsSafe);
		await store.record(from, to);
		vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('journal unavailable'));

		await expect(store.undo()).resolves.toEqual({ ok: true });
		await expect(store.undo()).resolves.toEqual({ ok: false, reason: 'empty' });
		expect(atomicRename).toHaveBeenCalledTimes(1);
	});

	it('reports empty when no journal entries exist', async () => {
		const store = new JournalStore(fsSafe);
		await expect(store.undo()).resolves.toEqual({ ok: false, reason: 'empty' });
	});

	it('retains only the newest configured number of entries on disk and in memory', async () => {
		const store = new JournalStore(fsSafe, 3);
		for (let i = 0; i < 5; i++) {
			await store.record(`from-${i}`, `to-${i}`);
		}

		const journal = await fs.readFile(
			path.join(process.env.XDG_STATE_HOME ?? '', 'namefix', 'journal.ndjson'),
			'utf8',
		);
		const entries = journal
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(entries.map((entry) => entry.from)).toEqual(['from-2', 'from-3', 'from-4']);
		expect((store as unknown as { cache: unknown[] }).cache).toHaveLength(3);
	});

	it('compacts an oversized journal from a previous daemon session', async () => {
		const journalDir = path.join(process.env.XDG_STATE_HOME ?? '', 'namefix');
		await fs.mkdir(journalDir, { recursive: true });
		await fs.writeFile(
			path.join(journalDir, 'journal.ndjson'),
			`${Array.from({ length: 5 }, (_, i) =>
				JSON.stringify({ from: `old-${i}`, to: `to-${i}`, ts: i }),
			).join('\n')}\n`,
		);

		const store = new JournalStore(fsSafe, 3);
		await store.record('new', 'new-target');

		const entries = (await fs.readFile(path.join(journalDir, 'journal.ndjson'), 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(entries.map((entry) => entry.from)).toEqual(['old-3', 'old-4', 'new']);
	});

	it('compacts an oversized journal on load without requiring a new record', async () => {
		const journalDir = path.join(process.env.XDG_STATE_HOME ?? '', 'namefix');
		const journalPath = path.join(journalDir, 'journal.ndjson');
		await fs.mkdir(journalDir, { recursive: true });
		await fs.writeFile(
			journalPath,
			`${Array.from({ length: 5 }, (_, i) =>
				JSON.stringify({ from: `old-${i}`, to: `missing-${i}`, ts: i }),
			).join('\n')}\n`,
		);

		const store = new JournalStore(fsSafe, 3);
		vi.spyOn(fsSafe, 'atomicRename').mockRejectedValue(new Error('locked'));
		await expect(store.undo()).resolves.toEqual({
			ok: false,
			reason: 'locked',
		});

		const entries = (await fs.readFile(journalPath, 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(entries.map((entry) => entry.from)).toEqual(['old-2', 'old-3', 'old-4']);
	});

	it('keeps memory consistent with the appended journal when compaction fails', async () => {
		const store = new JournalStore(fsSafe, 2);
		await store.record('from-0', 'to-0');
		await store.record('from-1', 'to-1');
		const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk failure'));

		await expect(store.record('from-2', 'to-2')).rejects.toThrow('disk failure');
		expect(
			(store as unknown as { cache: Array<{ from: string }> }).cache.map((entry) => entry.from),
		).toEqual(['from-0', 'from-1', 'from-2']);

		rename.mockRestore();
		await store.record('from-3', 'to-3');
		const journal = await fs.readFile(
			path.join(process.env.XDG_STATE_HOME ?? '', 'namefix', 'journal.ndjson'),
			'utf8',
		);
		expect(
			journal
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line).from),
		).toEqual(['from-2', 'from-3']);
	});
});
