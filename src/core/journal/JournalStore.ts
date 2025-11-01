import fs from 'node:fs/promises';
import fscb from 'node:fs';
import path from 'node:path';
import { stateDir } from '../../utils/paths.js';
import type { IJournalStore } from '../../types/index';
import type { FsSafe } from '../fs/FsSafe.js';

type Entry = { from: string; to: string; ts: number };

function journalDir() {
  return stateDir('namefix');
}

function journalPath() {
  return path.join(journalDir(), 'journal.ndjson');
}

export class JournalStore implements IJournalStore {
  private cache: Entry[] = [];
  constructor(private readonly fsSafe: FsSafe) {}

  private async ensure() { await fs.mkdir(journalDir(), { recursive: true }); }

  private async load(): Promise<Entry[]> {
    await this.ensure();
    try {
      const data = await fs.readFile(journalPath(), 'utf8');
      const lines = data.split(/\r?\n/).filter(Boolean);
      this.cache = lines.map((l) => JSON.parse(l));
    } catch (e: unknown) {
      if (isNodeError(e) && e.code !== 'ENOENT') {
        throw e;
      }
      this.cache = [];
    }
    return this.cache;
  }

  async record(from: string, to: string): Promise<void> {
    await this.ensure();
    const entry: Entry = { from, to, ts: Date.now() };
    await fs.appendFile(journalPath(), `${JSON.stringify(entry)}\n`, 'utf8');
    this.cache.push(entry);
  }

  async undo(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.cache.length) await this.load();
    const last = this.cache.pop();
    if (!last) return { ok: false, reason: 'empty' };
    try {
      const target = await this.restoreTarget(last);
      await this.fsSafe.atomicRename(last.to, target);
      await this.rewrite();
      return { ok: true };
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : 'rename_failed';
      return { ok: false, reason };
    }
  }

  private async restoreTarget(entry: Entry): Promise<string> {
    // If original is free, use it; else add _restored suffix
    const exists = await existsSafe(entry.from);
    if (!exists) return entry.from;
    const dir = path.dirname(entry.from);
    const ext = path.extname(entry.from);
    const base = path.basename(entry.from, ext);
    let n = 1;
    let candidate = path.join(dir, `${base}_restored${ext}`);
    while (await existsSafe(candidate)) {
      n++;
      candidate = path.join(dir, `${base}_restored_${n}${ext}`);
    }
    return candidate;
  }

  private async rewrite() {
    const tmp = `${journalPath()}.tmp`;
    const data = this.cache.map((e) => JSON.stringify(e)).join('\n') + (this.cache.length ? '\n' : '');
    await fs.writeFile(tmp, data, 'utf8');
    await fs.rename(tmp, journalPath());
  }

  dispose(): void | Promise<void> {
    // nothing
  }
}

async function existsSafe(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err;
}
