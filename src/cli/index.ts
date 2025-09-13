import { Command } from 'commander';
import { NamefixApp } from '../core/App.js';
import { createRequire } from 'node:module';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function run(argv: string[] = process.argv.slice(2)) {
  const program = new Command();
  program
    .name('namefix')
    .description('Minimal macOS screenshot renamer (TUI)')
    .option('-w, --watch <dir>', 'Watch directory override')
    .option('--dry-run', 'Start in dry-run mode')
    .option('--live', 'Start in live mode (apply)')
    .option('--prefix <prefix>', 'Prefix for names')
    .option('--include <globs...>', 'Include globs')
    .option('--exclude <globs...>', 'Exclude globs')
    .option('--theme <name>', 'Theme name')
    .option('--print-launchd', 'Print launchd plist to stdout and exit')
    .option('--version', 'Print version')
    .allowUnknownOption(false);

  program.parse(argv, { from: 'user' });
  const opts = program.opts();

  if (opts.version) {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json');
    console.log(pkg.version);
    return;
  }

  if (opts.printLaunchd) {
    const { LaunchdPrinter } = await import('../integrations/LaunchdPrinter.js');
    const binPath: string = fileURLToPath(new URL('../../bin/namefix.js', import.meta.url));
    const home = os.homedir();
    const watch: string = opts.watch ?? (home + '/Desktop');
    LaunchdPrinter.printPlist({ binPath, watchDir: watch });
    return;
  }

  const app = new NamefixApp();
  const overrides: any = {};
  if (opts.watch) overrides.watchDir = opts.watch;
  if (opts.dryRun) overrides.dryRun = true;
  if (opts.live) overrides.dryRun = false;
  if (opts.prefix) overrides.prefix = opts.prefix;
  if (opts.include) overrides.include = Array.isArray(opts.include) ? opts.include : [opts.include];
  if (opts.exclude) overrides.exclude = Array.isArray(opts.exclude) ? opts.exclude : [opts.exclude];
  if (opts.theme) overrides.theme = opts.theme;
  await app.start(overrides);
}
