import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type TrashResult = {
	srcPath: string;
	success: boolean;
	error?: string;
};

export class TrashService {
	async moveToTrash(filePath: string): Promise<TrashResult> {
		await fs.access(filePath);

		try {
			const trashDir = path.join(os.homedir(), '.Trash');
			const basename = path.basename(filePath);
			let dest = path.join(trashDir, basename);

			// Handle name collisions in Trash
			let n = 2;
			while (await fileExists(dest)) {
				const ext = path.extname(basename);
				const name = basename.slice(0, -ext.length || undefined);
				dest = path.join(trashDir, `${name} ${n}${ext}`);
				n++;
			}

			await fs.rename(filePath, dest);
			return { srcPath: filePath, success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error moving file to Trash';
			return { srcPath: filePath, success: false, error: message };
		}
	}
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}
