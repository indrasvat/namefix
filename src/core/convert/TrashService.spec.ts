import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrashService } from './TrashService.js';

vi.mock('node:fs/promises', () => ({
	default: {
		access: vi.fn(),
		rename: vi.fn(),
	},
}));

vi.mock('node:os', () => ({
	default: { homedir: () => '/Users/test' },
}));

import fs from 'node:fs/promises';

const mockAccess = vi.mocked(fs.access);
const mockRename = vi.mocked(fs.rename);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('TrashService', () => {
	describe('moveToTrash', () => {
		let svc: TrashService;

		beforeEach(() => {
			svc = new TrashService();
			// File exists
			mockAccess.mockImplementation(async (p) => {
				const ps = String(p);
				// Source file exists, trash destination does not
				if (ps.startsWith('/Users/test/.Trash/')) {
					throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
				}
			});
			mockRename.mockResolvedValue(undefined);
		});

		it('returns success when rename succeeds', async () => {
			const result = await svc.moveToTrash('/tmp/photo.heic');

			expect(result.srcPath).toBe('/tmp/photo.heic');
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it('renames file to ~/.Trash/', async () => {
			await svc.moveToTrash('/tmp/photo.heic');

			expect(mockRename).toHaveBeenCalledWith(
				'/tmp/photo.heic',
				'/Users/test/.Trash/photo.heic',
			);
		});

		it('returns failure with error when rename fails', async () => {
			mockRename.mockRejectedValue(new Error('EPERM: operation not permitted'));

			const result = await svc.moveToTrash('/tmp/photo.heic');

			expect(result.success).toBe(false);
			expect(result.error).toContain('operation not permitted');
		});

		it('throws error when file does not exist', async () => {
			mockAccess.mockRejectedValue(
				Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }),
			);

			await expect(svc.moveToTrash('/tmp/nonexistent.heic')).rejects.toThrow('ENOENT');
			expect(mockRename).not.toHaveBeenCalled();
		});
	});
});
