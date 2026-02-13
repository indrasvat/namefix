#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { access } from 'node:fs/promises';

let dead = false;

function safeStderr(msg) {
	if (dead) return;
	try {
		stderr.write(`${new Date().toISOString()} [bridge] ${msg}\n`);
	} catch {
		// stderr gone — nothing we can do
	}
}

function logToStderr(level) {
	return (...args) => {
		const message = args
			.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
			.join(' ');
		safeStderr(`[${level}] ${message}`);
	};
}

console.log = logToStderr('LOG');
console.warn = logToStderr('WARN');
console.error = logToStderr('ERROR');

function die(reason) {
	if (dead) return;
	dead = true;
	safeStderr(`FATAL: ${reason}`);
	exit(0);
}

// Catch everything that could kill the process
process.on('uncaughtException', (err) => {
	die(`uncaughtException: ${err?.stack ?? err?.message ?? err}`);
});
process.on('unhandledRejection', (reason) => {
	die(`unhandledRejection: ${reason instanceof Error ? reason.stack : reason}`);
});

stdout.on('error', () => die('stdout pipe error'));
stdin.on('error', () => die('stdin pipe error'));
stdin.on('end', () => die('stdin EOF (parent exited)'));

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
	process.on(sig, () => die(`signal ${sig}`));
}

const distCandidates = [
	'./dist/core/NamefixService.js', // packaged bundle (Contents/Resources/resources/dist)
	'../dist/core/NamefixService.js', // packaged bundle (alternative layout)
	'../../../../dist/core/NamefixService.js', // local development tree
];

let resolvedModuleUrl;
for (const candidate of distCandidates) {
	const candidateUrl = new URL(candidate, import.meta.url);
	const candidatePath = fileURLToPath(candidateUrl);
	try {
		await access(candidatePath);
		resolvedModuleUrl = candidateUrl;
		break;
	} catch {
		// try the next candidate
	}
}

if (!resolvedModuleUrl) {
	die(`build artifacts not found: ${distCandidates.join(', ')}`);
}

const emitterUnsubs = [];
let shuttingDown = false;
let serviceReady = false;
let service = null;

function sendMessage(payload) {
	if (dead || shuttingDown) return;
	try {
		stdout.write(`${JSON.stringify(payload)}\n`);
	} catch {
		// Don't die here — the stdout 'error' event handler will handle it
	}
}

function forwardEvents() {
	emitterUnsubs.push(
		service.on('status', (status) => {
			safeStderr(`[EVENT] status: running=${status.running}, dirs=${status.directories?.length ?? 0}, dryRun=${status.dryRun}`);
			sendMessage({ event: 'status', payload: status });
		}),
	);
	emitterUnsubs.push(
		service.on('file', (event) => {
			safeStderr(`[EVENT] file: ${event.kind} ${event.file ?? '?'}${event.target ? ` → ${event.target}` : ''}${event.message ? ` (${event.message})` : ''}`);
			sendMessage({ event: 'file', payload: event });
		}),
	);
	emitterUnsubs.push(
		service.on('toast', (toast) => {
			safeStderr(`[EVENT] toast: [${toast.level}] ${toast.message}`);
			sendMessage({ event: 'toast', payload: toast });
		}),
	);
	emitterUnsubs.push(
		service.on('config', (config) => {
			safeStderr('[EVENT] config changed');
			sendMessage({ event: 'config', payload: config });
		}),
	);
}

// Start init in background — readline loop starts IMMEDIATELY below
(async () => {
	try {
		const { NamefixService } = await import(resolvedModuleUrl);
		service = new NamefixService();
		await service.init();
		await service.start();
		serviceReady = true;
		forwardEvents();
		// Push initial status to Rust so tray updates right away
		sendMessage({ event: 'status', payload: service.getStatus() });
	} catch (err) {
		safeStderr(`init failed: ${err?.stack ?? err}`);
	}
})();

function requireReady(label) {
	if (!serviceReady || !service) {
		throw new Error(`Service not ready (${label})`);
	}
	return service;
}

const handlers = {
	async getStatus() {
		if (!serviceReady || !service) {
			return { running: false, directories: [], dryRun: false, launchOnLogin: false };
		}
		return service.getStatus();
	},
	async toggleRunning(params = {}) {
		const svc = requireReady('toggleRunning');
		const desired = params.desired;
		if (typeof desired === 'boolean') {
			const status = svc.getStatus();
			if (status.running !== desired) {
				await svc.toggleRunning();
			}
			return svc.getStatus();
		}
		await svc.toggleRunning();
		return svc.getStatus();
	},
	async listDirectories() {
		if (!serviceReady || !service) return [];
		return service.getStatus().directories;
	},
	async setLaunchOnLogin(params = {}) {
		const svc = requireReady('setLaunchOnLogin');
		const enabled = Boolean(params.enabled);
		await svc.setLaunchOnLogin(enabled);
		return svc.getConfig().launchOnLogin;
	},
	async setDryRun(params = {}) {
		const svc = requireReady('setDryRun');
		if (typeof params.enabled === 'boolean') {
			await svc.setDryRun(params.enabled);
		}
		return svc.getStatus();
	},
	async addWatchDir(params = {}) {
		const svc = requireReady('addWatchDir');
		const dir = params.directory;
		if (typeof dir !== 'string' || dir.trim().length === 0) {
			throw new Error('directory is required');
		}
		await svc.addWatchDir(dir);
		return svc.getStatus().directories;
	},
	async removeWatchDir(params = {}) {
		const svc = requireReady('removeWatchDir');
		const dir = params.directory;
		if (typeof dir !== 'string' || dir.trim().length === 0) {
			throw new Error('directory is required');
		}
		await svc.removeWatchDir(dir);
		return svc.getStatus().directories;
	},
	async undo() {
		const svc = requireReady('undo');
		return svc.undoLast();
	},

	// Profile management
	async getProfiles() {
		if (!serviceReady || !service) return [];
		return service.getProfiles();
	},
	async getProfile(params = {}) {
		const svc = requireReady('getProfile');
		const { id } = params;
		if (typeof id !== 'string') {
			throw new Error('profile id is required');
		}
		return svc.getProfile(id) ?? null;
	},
	async setProfile(params = {}) {
		const svc = requireReady('setProfile');
		const { profile } = params;
		if (!profile || typeof profile !== 'object') {
			throw new Error('profile is required');
		}
		await svc.setProfile(profile);
		return svc.getProfiles();
	},
	async deleteProfile(params = {}) {
		const svc = requireReady('deleteProfile');
		const { id } = params;
		if (typeof id !== 'string') {
			throw new Error('profile id is required');
		}
		await svc.deleteProfile(id);
		return svc.getProfiles();
	},
	async toggleProfile(params = {}) {
		const svc = requireReady('toggleProfile');
		const { id, enabled } = params;
		if (typeof id !== 'string') {
			throw new Error('profile id is required');
		}
		await svc.toggleProfile(id, enabled);
		return svc.getProfiles();
	},
	async reorderProfiles(params = {}) {
		const svc = requireReady('reorderProfiles');
		const { orderedIds } = params;
		if (!Array.isArray(orderedIds)) {
			throw new Error('orderedIds is required');
		}
		await svc.reorderProfiles(orderedIds);
		return svc.getProfiles();
	},

	async shutdown() {
		shuttingDown = true;
		for (const off of emitterUnsubs.splice(0)) {
			try {
				off();
			} catch {
				/* ignore */
			}
		}
		if (service) await service.stop();
		sendMessage({ event: 'shutdown', payload: {} });
		setTimeout(() => exit(0), 100);
		return true;
	},
};

const rl = createInterface({ input: stdin, crlfDelay: Number.POSITIVE_INFINITY });

for await (const line of rl) {
	if (dead) break;
	const trimmed = line.trim();
	if (!trimmed) continue;
	let payload;
	try {
		payload = JSON.parse(trimmed);
	} catch (err) {
		safeStderr(`bad JSON input: ${trimmed}`);
		sendMessage({ error: 'invalid_json', detail: String(err) });
		continue;
	}
	const { id, method, params } = payload;
	if (!method || typeof method !== 'string') {
		sendMessage({ id, error: 'invalid_method' });
		continue;
	}
	const handler = handlers[method];
	if (!handler) {
		sendMessage({ id, error: `unknown_method:${method}` });
		continue;
	}
	try {
		const result = await handler(params);
		sendMessage({ id, result });
	} catch (err) {
		sendMessage({ id, error: String(err instanceof Error ? err.message : err) });
	}
}
