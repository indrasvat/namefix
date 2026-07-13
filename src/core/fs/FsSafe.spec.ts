import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delay } from '../../utils/async.js';
import { FsSafe } from './FsSafe.js';

describe('FsSafe', () => {
	let tempRoot: string;
	let fsSafe: FsSafe;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'namefix-fssafe-'));
		fsSafe = new FsSafe();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it('waits through a disappearing source and completes an atomic rename when the file appears', async () => {
		const from = path.join(tempRoot, 'incoming.png');
		const to = path.join(tempRoot, 'nested', 'renamed.png');

		const renamePromise = fsSafe.atomicRename(from, to);
		await delay(50);
		await fs.writeFile(from, 'ready');

		await renamePromise;
		await expect(fs.readFile(to, 'utf8')).resolves.toBe('ready');
	});

	it('returns false when a file disappears during stability checks', async () => {
		const target = path.join(tempRoot, 'transient.png');
		await fs.writeFile(target, 'partial');
		const stablePromise = fsSafe.isStable(target);
		await fs.rm(target);

		await expect(stablePromise).resolves.toBe(false);
	});

	it('treats an unchanged file as stable', async () => {
		const target = path.join(tempRoot, 'stable.png');
		await fs.writeFile(target, 'complete');

		await expect(fsSafe.isStable(target)).resolves.toBe(true);
	});

	it('retries busy renames before succeeding', async () => {
		const from = path.join(tempRoot, 'busy.png');
		const to = path.join(tempRoot, 'renamed.png');
		await fs.writeFile(from, 'ready');
		const originalRename = fs.rename.bind(fs);
		const rename = vi.spyOn(fs, 'rename');
		rename
			.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
			.mockImplementationOnce(originalRename);
		vi.spyOn(Math, 'random').mockReturnValue(0);

		await fsSafe.atomicRename(from, to);

		expect(rename).toHaveBeenCalledTimes(2);
		await expect(fs.readFile(to, 'utf8')).resolves.toBe('ready');
	});

	it('rethrows non-missing stat errors during stability checks', async () => {
		const target = path.join(tempRoot, 'denied.png');
		vi.spyOn(fs, 'stat').mockRejectedValue(
			Object.assign(new Error('permission denied'), { code: 'EACCES' }),
		);

		await expect(fsSafe.isStable(target)).rejects.toThrow('permission denied');
	});
});
