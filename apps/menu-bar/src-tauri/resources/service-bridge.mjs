#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { access } from 'node:fs/promises';

function logToStderr(level) {
	return (...args) => {
		const message = args
			.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
			.join(' ');
		stderr.write(`${new Date().toISOString()} [${level}] ${message}\n`);
	};
}

console.log = logToStderr('LOG');
console.warn = logToStderr('WARN');
console.error = logToStderr('ERROR');

stdout.on('error', (err) => {
	if (
		typeof err === 'object' &&
		err !== null &&
		'code' in err &&
		(err.code === 'EPIPE' || err.code === 'ERR_STREAM_WRITE_AFTER_END')
	) {
		exit(0);
		return;
	}
	throw err;
});

function logDebug(message, extra = {}) {
	stderr.write(`${new Date().toISOString()} service-bridge ${message} ${JSON.stringify(extra)}\n`);
}

const distCandidates = [
	'./dist/core/NamefixService.js', // packaged bundle (Contents/Resources/resources/dist)
	'../dist/core/NamefixService.js', // packaged bundle (alternative layout)
	'../../../../dist/core/NamefixService.js', // local development tree
];

let resolvedModuleUrl;
let resolvedPath;
for (const candidate of distCandidates) {
	const candidateUrl = new URL(candidate, import.meta.url);
	const candidatePath = fileURLToPath(candidateUrl);
	try {
		await access(candidatePath);
		resolvedModuleUrl = candidateUrl;
		resolvedPath = candidatePath;
		break;
	} catch {
		// try the next candidate
	}
}

if (!resolvedModuleUrl) {
	stderr.write(`Namefix build artifacts not found. Checked: ${distCandidates.join(', ')}\n`);
	exit(1);
}

const { NamefixService } = await import(resolvedModuleUrl);
const service = new NamefixService();

await service.init();
await service.start();

const emitterUnsubs = [];
const SHUTDOWN_DELAY_MS = 100; // allow stdout flush before exiting the sidecar

function sendMessage(payload) {
	stdout.write(`${JSON.stringify(payload)}\n`);
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

let requestId = 0;

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
		for (const off of emitterUnsubs.splice(0)) {
			try {
				off();
			} catch {
				/* ignore */
			}
		}
		await service.stop();
		sendMessage({ event: 'shutdown', payload: {} });
		setTimeout(() => exit(0), SHUTDOWN_DELAY_MS);
		return true;
	},
};

const rl = createInterface({ input: stdin, crlfDelay: Number.POSITIVE_INFINITY });

for await (const line of rl) {
	const trimmed = line.trim();
	if (!trimmed) continue;
	requestId += 1;
	let payload;
	try {
		payload = JSON.parse(trimmed);
	} catch (err) {
		logDebug('failed to parse input', { trimmed });
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
