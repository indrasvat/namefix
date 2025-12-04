import os from 'node:os';
import path from 'node:path';

const isMac = process.platform === 'darwin';
const homeDir = os.homedir();

function ensureTrailing(app: string) {
	const trimmed = app?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : 'namefix';
}

export function configDir(app = 'namefix') {
	const appName = ensureTrailing(app);
	const override = process.env.NAMEFIX_HOME;
	if (override && override.length > 0) return override;
	const xdg = process.env.XDG_CONFIG_HOME;
	if (xdg && xdg.length > 0) return path.join(xdg, appName);
	if (isMac) return path.join(homeDir, 'Library', 'Application Support', appName);
	return path.join(homeDir, '.config', appName);
}

export function stateDir(app = 'namefix') {
	const appName = ensureTrailing(app);
	const xdg = process.env.XDG_STATE_HOME;
	if (xdg && xdg.length > 0) return path.join(xdg, appName);
	if (isMac) return path.join(homeDir, 'Library', 'Application Support', appName);
	return path.join(homeDir, '.local', 'state', appName);
}

export function cacheDir(app = 'namefix') {
	const appName = ensureTrailing(app);
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg && xdg.length > 0) return path.join(xdg, appName);
	if (isMac) return path.join(homeDir, 'Library', 'Caches', appName);
	return path.join(homeDir, '.cache', appName);
}

export function logsDir(app = 'namefix') {
	const override = process.env.NAMEFIX_LOGS;
	if (override && override.length > 0) return override;
	const appName = ensureTrailing(app);
	const xdgState = process.env.XDG_STATE_HOME;
	if (xdgState && xdgState.length > 0) return path.join(xdgState, appName, 'logs');
	if (isMac) return path.join(homeDir, 'Library', 'Logs', appName);
	return path.join(homeDir, '.local', 'state', appName, 'logs');
}

export function desktopPath() {
	return path.join(homeDir, 'Desktop');
}
