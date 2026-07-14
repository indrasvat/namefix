import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathExists } from './fs.js';

describe('pathExists', () => {
	let tempRoot: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'namefix-path-exists-'));
	});

	afterEach(async () => {
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it('distinguishes existing files from missing paths without throwing', async () => {
		const existing = path.join(tempRoot, 'file.txt');
		await fs.writeFile(existing, 'ok');

		await expect(pathExists(existing)).resolves.toBe(true);
		await expect(pathExists(path.join(tempRoot, 'missing.txt'))).resolves.toBe(false);
	});
});
