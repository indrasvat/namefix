import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { RenameService } from './RenameService.js';
import { buildName } from './NameTemplate.js';
import type { IProfile } from '../../types/index.js';

function suffix(base: string, index: number): string {
	const ext = path.extname(base);
	const name = base.slice(0, -ext.length);
	return `${name}_${index}${ext}`;
}

describe('RenameService', () => {
	test('reserves unique candidates while previous rename is in flight', async () => {
		const renamer = new RenameService();
		const dir = await mkdtemp(path.join(tmpdir(), 'namefix-renamer-'));
		const when = new Date(2025, 8, 30, 18, 10, 10);
		const baseName = buildName('Screenshot', when, '.png');

		const [first, second] = await Promise.all([
			renamer.targetFor(path.join(dir, 'Screenshot 2025-09-30 at 6.10.03 PM.png'), {
				birthtime: when,
				ext: '.png',
				prefix: 'Screenshot',
			}),
			renamer.targetFor(path.join(dir, 'Screenshot 2025-09-30 at 6.10.03 PM (2).png'), {
				birthtime: when,
				ext: '.png',
				prefix: 'Screenshot',
			}),
		]);

		expect(first).toBe(baseName);
		expect(second).toBe(suffix(baseName, 2));

		renamer.release(dir, first);
		renamer.release(dir, second);
	});

	test('honours existing files after release', async () => {
		const renamer = new RenameService();
		const dir = await mkdtemp(path.join(tmpdir(), 'namefix-renamer-'));
		const when = new Date(2025, 8, 30, 18, 10, 10);
		const baseName = buildName('Screenshot', when, '.png');

		const candidate = await renamer.targetFor(path.join(dir, 'foo.png'), {
			birthtime: when,
			ext: '.png',
			prefix: 'Screenshot',
		});
		expect(candidate).toBe(baseName);
		renamer.release(dir, candidate);

		await writeFile(path.join(dir, candidate), '');

		const next = await renamer.targetFor(path.join(dir, 'bar.png'), {
			birthtime: when,
			ext: '.png',
			prefix: 'Screenshot',
		});
		expect(next).toBe(suffix(baseName, 2));
		renamer.release(dir, next);
	});

	test('detects idempotent legacy and profile names before renaming', () => {
		const renamer = new RenameService();
		const profile: IProfile = {
			id: 'screenshots',
			name: 'Screenshots',
			enabled: true,
			pattern: 'Screenshot*',
			isRegex: false,
			template: '<prefix>_<datetime>',
			prefix: 'Client Capture',
			priority: 1,
		};

		expect(renamer.needsRename('Screenshot_2026-07-13_09-08-07.png', 'Screenshot')).toBe(false);
		expect(renamer.needsRename('Screenshot 2026-07-13 at 9.08.07 AM.png', 'Screenshot')).toBe(true);
		expect(
			renamer.needsRenameForProfile('Client_Capture_2026-07-13_09-08-07_2.jpeg', profile),
		).toBe(false);
		expect(renamer.needsRenameForProfile('Client Capture original.jpeg', profile)).toBe(true);
		expect(renamer.needsRename('Screenshot_2026-07-13_09-08-07.mov', '')).toBe(false);
		expect(
			renamer.needsRenameForProfile('File_2026-07-13_09-08-07.png', {
				...profile,
				prefix: '',
			}),
		).toBe(false);
	});

	test('builds profile targets with default extensions and collision suffixes', async () => {
		const renamer = new RenameService();
		const dir = await mkdtemp(path.join(tmpdir(), 'namefix-profile-renamer-'));
		const profile: IProfile = {
			id: 'raw',
			name: 'Raw Captures',
			enabled: true,
			pattern: 'Capture*',
			isRegex: false,
			template: '<original>',
			prefix: 'Capture',
			priority: 1,
		};

		await writeFile(path.join(dir, 'Capture_001.png'), 'existing');
		const target = await renamer.targetForProfile(
			path.join(dir, 'Capture_001'),
			{ birthtime: new Date(2026, 6, 13) },
			profile,
		);

		expect(target).toMatchObject({ filename: 'Capture_001_2.png', profile });
		renamer.release(dir, target.filename);
	});

	test('uses legacy defaults when optional stat and profile fields are omitted', async () => {
		const renamer = new RenameService();
		const dir = await mkdtemp(path.join(tmpdir(), 'namefix-default-renamer-'));
		const profile: IProfile = {
			id: 'defaulted',
			name: 'Defaulted',
			enabled: true,
			pattern: '*',
			isRegex: false,
			template: '',
			prefix: '',
			priority: 1,
		};

		const legacy = await renamer.targetFor(path.join(dir, 'plain'), {
			birthtime: new Date(2026, 6, 13, 9, 8, 7),
		});
		const templated = await renamer.targetForProfile(
			path.join(dir, 'plain'),
			{ birthtime: new Date(2026, 6, 13, 9, 8, 7) },
			profile,
		);

		expect(legacy).toBe('Screenshot_2026-07-13_09-08-07.png');
		expect(templated.filename).toBe('File_2026-07-13_09-08-07.png');
		renamer.release(dir, legacy);
		renamer.release(dir, templated.filename);
	});
});
