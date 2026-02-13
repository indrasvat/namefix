import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrashService } from './TrashService.js';

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

function mockExecFileFailure(message: string) {
	mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cb: unknown) => {
		(cb as Cb)(new Error(message));
		return undefined as unknown as ReturnType<typeof execFileCb>;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('TrashService', () => {
	describe('moveToTrash', () => {
		let svc: TrashService;

		beforeEach(() => {
			svc = new TrashService();
			mockAccess.mockResolvedValue(undefined);
		});

		it('returns success when osascript succeeds', async () => {
			mockExecFileSuccess();

			const result = await svc.moveToTrash('/tmp/photo.heic');

			expect(result.srcPath).toBe('/tmp/photo.heic');
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it('calls osascript with correct AppleScript argument', async () => {
			mockExecFileSuccess();

			await svc.moveToTrash('/tmp/photo.heic');

			expect(mockExecFile).toHaveBeenCalledWith(
				'osascript',
				['-e', 'tell application "Finder" to delete POSIX file "/tmp/photo.heic"'],
				expect.any(Function),
			);
		});

		it('returns failure with error when osascript fails', async () => {
			mockExecFileFailure('osascript: permission denied');

			const result = await svc.moveToTrash('/tmp/photo.heic');

			expect(result.success).toBe(false);
			expect(result.error).toContain('permission denied');
		});

		it('throws error when file does not exist', async () => {
			mockAccess.mockRejectedValue(
				Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }),
			);

			await expect(svc.moveToTrash('/tmp/nonexistent.heic')).rejects.toThrow('ENOENT');
			expect(mockExecFile).not.toHaveBeenCalled();
		});
	});
});
