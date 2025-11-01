import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { RenameService } from './RenameService.js';
import { buildName } from './NameTemplate.js';

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
        prefix: 'Screenshot'
      }),
      renamer.targetFor(path.join(dir, 'Screenshot 2025-09-30 at 6.10.03 PM (2).png'), {
        birthtime: when,
        ext: '.png',
        prefix: 'Screenshot'
      })
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
      prefix: 'Screenshot'
    });
    expect(candidate).toBe(baseName);
    renamer.release(dir, candidate);

    await writeFile(path.join(dir, candidate), '');

    const next = await renamer.targetFor(path.join(dir, 'bar.png'), {
      birthtime: when,
      ext: '.png',
      prefix: 'Screenshot'
    });
    expect(next).toBe(suffix(baseName, 2));
    renamer.release(dir, next);
  });
});
