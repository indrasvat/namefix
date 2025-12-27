import fs from 'node:fs/promises';
import path from 'node:path';

export class FsSafe {
	/**
	 * Checks if a file has stabilized (size unchanged for ~250ms).
	 * Returns false if file disappears during check (not an error).
	 */
	async isStable(p: string): Promise<boolean> {
		const start = Date.now();
		let prev: number | null = null;

		while (true) {
			let st: Awaited<ReturnType<typeof fs.stat>>;
			try {
				st = await fs.stat(p);
			} catch (err) {
				// File disappeared - not stable (but not an error)
				if (isMissingError(err)) {
					return false;
				}
				throw err; // Re-throw other errors
			}

			const size = st.size;
			if (prev !== null && size === prev) return true;
			prev = size;
			if (Date.now() - start > 750) return true; // idle window
			await delay(250);

			// Second stat check
			let st2: Awaited<ReturnType<typeof fs.stat>>;
			try {
				st2 = await fs.stat(p);
			} catch (err) {
				if (isMissingError(err)) {
					return false;
				}
				throw err;
			}

			if (st2.size === size) return true;
			prev = st2.size;
			if (Date.now() - start > 750) return true;
			await delay(250);
		}
	}

	async atomicRename(from: string, to: string): Promise<void> {
		await fs.mkdir(path.dirname(to), { recursive: true });
		const maxAttempts = 10;
		for (let i = 0; i < maxAttempts; i++) {
			try {
				await fs.rename(from, to);
				return;
			} catch (err) {
				if (isBusyError(err) && i < maxAttempts - 1) {
					await delay(50 + Math.floor(Math.random() * 100));
					continue;
				}
				if (isMissingError(err) && i < maxAttempts - 1) {
					await delay(150 + Math.floor(Math.random() * 250));
					continue;
				}
				throw err;
			}
		}
	}
}

function delay(ms: number) {
	return new Promise((res) => setTimeout(res, ms));
}

function isBusyError(err: unknown): err is NodeJS.ErrnoException {
	return (
		typeof err === 'object' &&
		err !== null &&
		'code' in err &&
		(err as NodeJS.ErrnoException).code === 'EBUSY'
	);
}

function isMissingError(err: unknown): err is NodeJS.ErrnoException {
	return (
		typeof err === 'object' &&
		err !== null &&
		'code' in err &&
		(err as NodeJS.ErrnoException).code === 'ENOENT'
	);
}
