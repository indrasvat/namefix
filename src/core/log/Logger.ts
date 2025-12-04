import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ILogger } from '../../types/index';
import { logsDir } from '../../utils/paths.js';

type Level = 'info' | 'warn' | 'error' | 'debug';

export class Logger implements ILogger {
	private stream: fs.WriteStream | null = null;
	private ring: string[] = [];
	private max = 500;
	private logFile: string | null = null;

	constructor() {
		this.init().catch(() => {
			/* ignore */
		});
	}

	private async init() {
		const dir = logsDir('namefix');
		await fsp.mkdir(dir, { recursive: true });
		this.logFile = path.join(dir, 'session.log');
		this.stream = fs.createWriteStream(this.logFile, { flags: 'a', encoding: 'utf8' });
	}

	private pushRing(line: string) {
		this.ring.push(line);
		if (this.ring.length > this.max) this.ring.shift();
	}

	private write(level: Level, msg: string, meta?: Record<string, unknown>) {
		const ts = new Date().toISOString();
		const rec = { ts, level, msg, ...(meta ? { meta } : {}) };
		const line = JSON.stringify(rec);
		this.pushRing(line);
		try {
			if (this.stream) this.stream.write(`${line}\n`);
		} catch {
			// ignore
		}
		// Also echo human-readable to stdout for dev
		const human = `[${ts}] ${level.toUpperCase()} ${msg}`;
		if (level === 'error') console.error(human);
		else if (level === 'warn') console.warn(human);
		else console.log(human);
	}

	info(msg: string, meta?: Record<string, unknown>): void {
		this.write('info', msg, meta);
	}
	warn(msg: string, meta?: Record<string, unknown>): void {
		this.write('warn', msg, meta);
	}
	error(msg: string | Error, meta?: Record<string, unknown>): void {
		if (msg instanceof Error) this.write('error', msg.message, { stack: msg.stack, ...meta });
		else this.write('error', msg, meta);
	}
	debug(msg: string, meta?: Record<string, unknown>): void {
		this.write('debug', msg, meta);
	}

	getRing(): string[] {
		return [...this.ring];
	}
}
