import fs from 'node:fs/promises';
import path from 'node:path';
import { buildName, getExt } from './NameTemplate.js';

export class RenameService {
  private readonly inFlightTargets = new Set<string>();

  needsRename(filename: string, prefix: string): boolean {
    const base = path.basename(filename);
    const p = (prefix || 'Screenshot').trim().replace(/\s+/g, '_');
    const re = new RegExp(`^${escapeRegExp(p)}_\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}(?:_\\d+)?\\.(png|jpg|jpeg)$`, 'i');
    return !re.test(base);
  }

  async targetFor(srcPath: string, stat: { birthtime: Date; ext?: string; prefix?: string }): Promise<string> {
    const dir = path.dirname(srcPath);
    const ext = (stat.ext || getExt(srcPath) || '.png').replace(/^\.+/, '.');
    const base = buildName(stat.prefix || 'Screenshot', stat.birthtime ?? new Date(), ext);
    return await this.reserveTarget(dir, base);
  }

  release(dir: string, target: string): void {
    this.inFlightTargets.delete(fullPath(dir, target));
  }

  private async reserveTarget(dir: string, base: string): Promise<string> {
    const { name, ext } = splitBase(base);
    let candidate = base;
    let n = 2;
    while (true) {
      const key = fullPath(dir, candidate);
      if (this.inFlightTargets.has(key)) {
        candidate = `${name}_${n}${ext}`;
        n++;
        continue;
      }

      this.inFlightTargets.add(key);
      const occupied = await exists(path.join(dir, candidate));
      if (!occupied) return candidate;

      this.inFlightTargets.delete(key);
      candidate = `${name}_${n}${ext}`;
      n++;
    }
  }
}

function splitBase(filename: string): { name: string; ext: string } {
  const ext = path.extname(filename);
  const name = filename.slice(0, -ext.length);
  return { name, ext };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

function fullPath(dir: string, name: string): string {
  return path.resolve(dir, name);
}
