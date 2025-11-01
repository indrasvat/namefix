import fs from 'node:fs/promises';
import path from 'node:path';

export class FsSafe {
  async isStable(p: string): Promise<boolean> {
    const start = Date.now();
    let prev: number | null = null;
    while (true) {
      const st = await fs.stat(p);
      const size = st.size;
      if (prev !== null && size === prev) return true;
      prev = size;
      if (Date.now() - start > 750) return true; // idle window
      await delay(250);
      // Loop to check unchanged twice at 250ms intervals
      const st2 = await fs.stat(p);
      if (st2.size === size) return true;
      prev = st2.size;
      if (Date.now() - start > 750) return true;
      await delay(250);
    }
  }

  async atomicRename(from: string, to: string): Promise<void> {
    await fs.mkdir(path.dirname(to), { recursive: true });
    const maxAttempts = 5;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await fs.rename(from, to);
        return;
      } catch (err) {
        if (isBusyError(err) && i < maxAttempts - 1) {
          await delay(50 + Math.floor(Math.random() * 100));
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
  return typeof err === 'object' && err !== null && 'code' in err && (err as NodeJS.ErrnoException).code === 'EBUSY';
}
