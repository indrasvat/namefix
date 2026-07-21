import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceFileEvent } from '../types/service.js';
import { NamefixService } from './NamefixService.js';

describe('NamefixService real watcher integration', () => {
	let tempRoot: string;
	let watchDir: string;
	let service: NamefixService | null = null;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'namefix-real-watch-'));
		watchDir = path.join(tempRoot, 'Desktop');
		await fs.mkdir(watchDir, { recursive: true });
		process.env.NAMEFIX_HOME = path.join(tempRoot, 'config');
		process.env.NAMEFIX_LOGS = path.join(tempRoot, 'logs');
	});

	afterEach(async () => {
		if (service) {
			await service.stop();
			service = null;
		}
		process.env.NAMEFIX_HOME = undefined;
		process.env.NAMEFIX_LOGS = undefined;
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	async function checkWatcherHealth(svc: NamefixService) {
		await (
			svc as unknown as {
				checkWatcherHealth(): Promise<void>;
			}
		).checkWatcherHealth();
	}

	async function waitForFileEvent(
		events: ServiceFileEvent[],
		predicate: (event: ServiceFileEvent) => boolean,
		timeoutMs = 5_000,
	): Promise<ServiceFileEvent> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const event = events.find(predicate);
			if (event) return event;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`Timed out waiting for file event. Saw: ${JSON.stringify(events)}`);
	}

	async function writeScreenshot(filename: string) {
		await fs.writeFile(path.join(watchDir, filename), 'fake-png-data');
	}

	it('processes files after the watched directory disappears and is recreated by recovery', async () => {
		service = new NamefixService();
		await service.init({
			watchDir,
			watchDirs: [watchDir],
			dryRun: true,
		});

		const events: ServiceFileEvent[] = [];
		service.on('file', (event) => events.push(event));

		await service.start();
		await writeScreenshot('Screenshot before failure.png');

		await waitForFileEvent(
			events,
			(event) => event.kind === 'preview' && event.file.includes('before failure'),
		);

		await fs.rm(watchDir, { recursive: true, force: true });
		await checkWatcherHealth(service);
		await fs.access(watchDir);

		await writeScreenshot('Screenshot after recovery.png');
		const recovered = await waitForFileEvent(
			events,
			(event) => event.kind === 'preview' && event.file.includes('after recovery'),
		);

		expect(recovered).toMatchObject({
			kind: 'preview',
			directory: watchDir,
			file: 'Screenshot after recovery.png',
		});
	}, 15_000);

	it('survives repeated watch-directory loss and recovery cycles', async () => {
		service = new NamefixService();
		await service.init({
			watchDir,
			watchDirs: [watchDir],
			dryRun: true,
		});

		const events: ServiceFileEvent[] = [];
		service.on('file', (event) => events.push(event));

		await service.start();

		for (let i = 1; i <= 3; i++) {
			await fs.rm(watchDir, { recursive: true, force: true });
			await checkWatcherHealth(service);
			await fs.access(watchDir);

			const filename = `Screenshot recovered cycle ${i}.png`;
			await writeScreenshot(filename);
			await waitForFileEvent(
				events,
				(event) => event.kind === 'preview' && event.file === filename,
			);
		}

		expect(
			events.filter((event) => event.kind === 'preview' && event.file.includes('recovered cycle')),
		).toHaveLength(3);
	}, 15_000);
});
