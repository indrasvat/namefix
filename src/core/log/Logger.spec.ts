import type fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from './Logger.js';

describe('Logger', () => {
	let tempRoot: string;

	beforeEach(async () => {
		tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'namefix-logger-'));
		process.env.NAMEFIX_LOGS = path.join(tempRoot, 'logs');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(async () => {
		process.env.NAMEFIX_LOGS = undefined;
		vi.restoreAllMocks();
		await fsp.rm(tempRoot, { recursive: true, force: true });
	});

	it('records info, warn, debug, string errors, and Error objects in the ring buffer', async () => {
		const logger = new Logger();

		logger.info('started', { dir: '/tmp/screens' });
		logger.warn('watch degraded');
		logger.debug('health tick');
		logger.error('plain failure');
		logger.error(new Error('rich failure'), { retry: true });

		const records = logger.getRing().map((line) => JSON.parse(line));
		expect(records.map((record) => record.level)).toEqual([
			'info',
			'warn',
			'debug',
			'error',
			'error',
		]);
		expect(records[0]).toMatchObject({ msg: 'started', meta: { dir: '/tmp/screens' } });
		expect(records[4].msg).toBe('rich failure');
		expect(records[4].meta.retry).toBe(true);
		expect(records[4].meta.stack).toContain('rich failure');
		expect(console.log).toHaveBeenCalled();
		expect(console.warn).toHaveBeenCalled();
		expect(console.error).toHaveBeenCalled();
		await logger.flush();
	});

	it('keeps only the newest 500 ring entries', async () => {
		const logger = new Logger();

		for (let i = 0; i < 505; i++) {
			logger.info(`entry-${i}`);
		}

		const records = logger.getRing().map((line) => JSON.parse(line));
		expect(records).toHaveLength(500);
		expect(records[0].msg).toBe('entry-5');
		expect(records.at(-1)?.msg).toBe('entry-504');
		await logger.flush();
	});

	it('ignores asynchronous log file initialization failures', async () => {
		vi.spyOn(fsp, 'mkdir').mockRejectedValue(new Error('readonly'));

		const logger = new Logger();
		logger.info('still logs to ring');
		await new Promise((resolve) => setImmediate(resolve));

		expect(logger.getRing()).toHaveLength(1);
	});

	it('ignores stream write failures after initialization', () => {
		const logger = new Logger();
		const stream = {
			write: vi.fn(() => {
				throw new Error('disk full');
			}),
		};
		(logger as unknown as { stream: Pick<fs.WriteStream, 'write'> }).stream = stream;

		expect(() => logger.info('survives stream failure')).not.toThrow();
		expect(logger.getRing()).toHaveLength(1);
	});

	it('rotates log files and bounds retained disk usage', async () => {
		const logger = new Logger({ maxBytes: 120, maxFiles: 2 });
		for (let i = 0; i < 20; i++) {
			logger.info(`entry-${i}-${'x'.repeat(30)}`);
		}
		await logger.flush();

		const files = (await fsp.readdir(process.env.NAMEFIX_LOGS ?? '')).filter((name) =>
			name.startsWith('session.log'),
		);
		expect(files.sort()).toEqual(['session.log', 'session.log.1']);
		for (const file of files) {
			const stat = await fsp.stat(path.join(process.env.NAMEFIX_LOGS ?? '', file));
			expect(stat.size).toBeLessThanOrEqual(240);
		}
	});

	it('bounds disk usage when configured to retain only the active log', async () => {
		const logger = new Logger({ maxBytes: 120, maxFiles: 1 });
		for (let i = 0; i < 10; i++) logger.info(`single-${i}-${'x'.repeat(30)}`);
		await logger.flush();

		const files = await fsp.readdir(process.env.NAMEFIX_LOGS ?? '');
		expect(files).toEqual(['session.log']);
		const file = files[0];
		if (!file) throw new Error('active log file missing');
		expect(
			(await fsp.stat(path.join(process.env.NAMEFIX_LOGS ?? '', file))).size,
		).toBeLessThanOrEqual(240);
	});
});
