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

const { NamefixService } = await import(resolvedModuleUrl);
const service = new NamefixService();

await service.init();
await service.start();

const emitterUnsubs = [];
let shuttingDown = false;

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
		service.on('status', (status) => sendMessage({ event: 'status', payload: status })),
	);
	emitterUnsubs.push(service.on('file', (event) => sendMessage({ event: 'file', payload: event })));
	emitterUnsubs.push(
		service.on('toast', (toast) => sendMessage({ event: 'toast', payload: toast })),
	);
	emitterUnsubs.push(
		service.on('config', (config) => sendMessage({ event: 'config', payload: config })),
	);
}

forwardEvents();

const handlers = {
	async getStatus() {
		return service.getStatus();
	},
	async toggleRunning(params = {}) {
		const desired = params.desired;
		if (typeof desired === 'boolean') {
			const status = service.getStatus();
			if (status.running !== desired) {
				await service.toggleRunning();
			}
			return service.getStatus();
		}
		await service.toggleRunning();
		return service.getStatus();
	},
	async listDirectories() {
		return service.getStatus().directories;
	},
	async setLaunchOnLogin(params = {}) {
		const enabled = Boolean(params.enabled);
		await service.setLaunchOnLogin(enabled);
		return service.getConfig().launchOnLogin;
	},
	async setDryRun(params = {}) {
		if (typeof params.enabled === 'boolean') {
			await service.setDryRun(params.enabled);
		}
		return service.getStatus();
	},
	async addWatchDir(params = {}) {
		const dir = params.directory;
		if (typeof dir !== 'string' || dir.trim().length === 0) {
			throw new Error('directory is required');
		}
		await service.addWatchDir(dir);
		return service.getStatus().directories;
	},
	async removeWatchDir(params = {}) {
		const dir = params.directory;
		if (typeof dir !== 'string' || dir.trim().length === 0) {
			throw new Error('directory is required');
		}
		await service.removeWatchDir(dir);
		return service.getStatus().directories;
	},
	async undo() {
		return service.undoLast();
	},

	// Profile management
	async getProfiles() {
		return service.getProfiles();
	},
	async getProfile(params = {}) {
		const { id } = params;
		if (typeof id !== 'string') {
			throw new Error('profile id is required');
		}
		return service.getProfile(id) ?? null;
	},
	async setProfile(params = {}) {
		const { profile } = params;
		if (!profile || typeof profile !== 'object') {
			throw new Error('profile is required');
		}
		await service.setProfile(profile);
		return service.getProfiles();
	},
	async deleteProfile(params = {}) {
		const { id } = params;
		if (typeof id !== 'string') {
			throw new Error('profile id is required');
		}
		await service.deleteProfile(id);
		return service.getProfiles();
	},
	async toggleProfile(params = {}) {
		const { id, enabled } = params;
		if (typeof id !== 'string') {
			throw new Error('profile id is required');
		}
		await service.toggleProfile(id, enabled);
		return service.getProfiles();
	},
	async reorderProfiles(params = {}) {
		const { orderedIds } = params;
		if (!Array.isArray(orderedIds)) {
			throw new Error('orderedIds is required');
		}
		await service.reorderProfiles(orderedIds);
		return service.getProfiles();
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
		await service.stop();
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
