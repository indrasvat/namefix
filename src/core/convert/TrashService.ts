import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export type TrashResult = {
	srcPath: string;
	success: boolean;
	error?: string;
};

export class TrashService {
	async moveToTrash(filePath: string): Promise<TrashResult> {
		await fs.access(filePath);

		try {
			await execFile('osascript', [
				'-e',
				`tell application "Finder" to delete POSIX file "${filePath}"`,
			]);
			return { srcPath: filePath, success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error moving file to Trash';
			return { srcPath: filePath, success: false, error: message };
		}
	}
}
