#!/usr/bin/env node
// Entrypoint for namefix. Delegates to built CLI in dist.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // Prefer built CLI in dist/cli/index.js
  const distPath = path.resolve(__dirname, '../dist/cli/index.js');
  try {
    const spec = await import(pathToFileURL(distPath).href);
    if (spec && typeof spec.run === 'function') {
      try {
        await spec.run(process.argv.slice(2));
        return;
      } catch (runErr) {
        console.error('namefix: runtime error:', runErr?.stack || runErr?.message || String(runErr));
      }
    }
  } catch (err) {
    // Module import failed; fall back to stub
  }

  // Minimal fallback so `--version` works even before build
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    const args = process.argv.slice(2);
    if (args.includes('--version') || args.includes('-v')) {
      console.log(pkg.version);
      process.exit(0);
    }
    console.log('namefix: development stub');
    console.log('  Build not found. Try `npm run build`.');
    console.log('  Flags: --version');
  } catch {
    console.log('namefix');
  }
}

main();
