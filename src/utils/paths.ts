import os from 'node:os';
import path from 'node:path';

export function librarySupportPath(app = 'namefix') {
  const override = process.env.NAMEFIX_HOME;
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), 'Library', 'Application Support', app);
}

export function logsPath(app = 'namefix') {
  const override = process.env.NAMEFIX_LOGS;
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), 'Library', 'Logs', app);
}

export function desktopPath() {
  return path.join(os.homedir(), 'Desktop');
}
