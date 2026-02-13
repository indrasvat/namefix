import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversionService } from './ConversionService.js';

vi.mock('node:child_process', () => {
	const fn = vi.fn();
	return { execFile: fn };
});

vi.mock('node:fs/promises', () => ({
	default: { access: vi.fn() },
}));

import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';

const mockExecFile = vi.mocked(execFileCb);
const mockAccess = vi.mocked(fs.access);

// biome-ignore lint/suspicious/noExplicitAny: required for mocking Node callback-style execFile
type Cb = (...a: unknown[]) => any;

function mockExecFileSuccess() {
	mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cb: unknown) => {
		(cb as Cb)(null, { stdout: '', stderr: '' });
		return undefined as unknown as ReturnType<typeof execFileCb>;
	});
}

function mockExecFileFailure(message: string, extra?: Record<string, unknown>) {
	mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cb: unknown) => {
		(cb as Cb)(Object.assign(new Error(message), extra));
		return undefined as unknown as ReturnType<typeof execFileCb>;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('ConversionService', () => {
	describe('canConvert', () => {
		const svc = new ConversionService();

		it('returns true for .heic, .heif, .HEIC (case-insensitive)', () => {
			expect(svc.canConvert('.heic')).toBe(true);
			expect(svc.canConvert('.heif')).toBe(true);
			expect(svc.canConvert('.HEIC')).toBe(true);
			expect(svc.canConvert('.HEIF')).toBe(true);
		});

		it('returns true for other supported formats', () => {
			expect(svc.canConvert('.png')).toBe(true);
			expect(svc.canConvert('.jpg')).toBe(true);
			expect(svc.canConvert('.jpeg')).toBe(true);
			expect(svc.canConvert('.tiff')).toBe(true);
			expect(svc.canConvert('.bmp')).toBe(true);
			expect(svc.canConvert('.gif')).toBe(true);
		});

		it('returns false for unsupported formats', () => {
			expect(svc.canConvert('.mp4')).toBe(false);
			expect(svc.canConvert('.pdf')).toBe(false);
			expect(svc.canConvert('.txt')).toBe(false);
			expect(svc.canConvert('.zip')).toBe(false);
		});
	});

	describe('convert', () => {
		let svc: ConversionService;

		beforeEach(() => {
			svc = new ConversionService();
			mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
		});

		it('calls sips with correct args for successful conversion', async () => {
			mockExecFileSuccess();

			const result = await svc.convert('/tmp/IMG_1234.heic', {
				outputFormat: 'jpeg',
			});

			expect(result.srcPath).toBe('/tmp/IMG_1234.heic');
			expect(result.destPath).toBe('/tmp/IMG_1234.jpeg');
			expect(result.format).toBe('jpeg');
			expect(result.durationMs).toBeGreaterThanOrEqual(0);

			expect(mockExecFile).toHaveBeenCalledWith(
				'sips',
				[
					'--setProperty',
					'format',
					'jpeg',
					'--setProperty',
					'formatOptions',
					'90',
					'/tmp/IMG_1234.heic',
					'--out',
					'/tmp/IMG_1234.jpeg',
				],
				expect.any(Function),
			);
		});

		it('passes JPEG quality option to sips', async () => {
			mockExecFileSuccess();

			await svc.convert('/tmp/photo.heic', {
				outputFormat: 'jpeg',
				quality: 75,
			});

			expect(mockExecFile).toHaveBeenCalledWith(
				'sips',
				expect.arrayContaining(['--setProperty', 'formatOptions', '75']),
				expect.any(Function),
			);
		});

		it('omits formatOptions for non-jpeg formats', async () => {
			mockExecFileSuccess();

			await svc.convert('/tmp/photo.heic', { outputFormat: 'png' });

			const args = mockExecFile.mock.calls[0]?.[1] as string[];
			expect(args).not.toContain('formatOptions');
		});

		it('throws error when sips exits with non-zero code', async () => {
			mockExecFileFailure('sips failed', {
				stderr: 'Error: unsupported format',
				code: 1,
			});

			await expect(svc.convert('/tmp/photo.heic', { outputFormat: 'jpeg' })).rejects.toThrow(
				'sips failed',
			);
		});

		it('appends _2 suffix when output path already exists', async () => {
			let accessCallCount = 0;
			mockAccess.mockImplementation(async () => {
				accessCallCount++;
				if (accessCallCount === 1) return undefined;
				throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
			});

			mockExecFileSuccess();

			const result = await svc.convert('/tmp/IMG_1234.heic', {
				outputFormat: 'jpeg',
			});

			expect(result.destPath).toBe('/tmp/IMG_1234_2.jpeg');
		});

		it('respects custom outputDir', async () => {
			mockExecFileSuccess();

			const result = await svc.convert('/tmp/IMG_1234.heic', {
				outputFormat: 'jpeg',
				outputDir: '/output',
			});

			expect(result.destPath).toBe('/output/IMG_1234.jpeg');
		});
	});
});
