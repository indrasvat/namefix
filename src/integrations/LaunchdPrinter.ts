import os from 'node:os';
import path from 'node:path';

export class LaunchdPrinter {
  static printPlist(opts: { label?: string; binPath: string; watchDir: string; args?: string[] }) {
    const label = opts.label || 'com.namefix.app';
    const program = opts.binPath;
    const runArgs = [program, '--watch', opts.watchDir, '--live', ...(opts.args || [])];
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProgramArguments</key>
  <array>
    ${runArgs.map((a) => `<string>${escapeXml(a)}</string>`).join('\n    ')}
  </array>
  <key>StandardOutPath</key>
  <string>${path.join(os.homedir(), 'Library/Logs/namefix/launchd.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), 'Library/Logs/namefix/launchd.err.log')}</string>
</dict>
</plist>`;
    // Print to stdout
    process.stdout.write(plist + '\n');
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

