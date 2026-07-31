import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ILogger } from '../../types/index';
import { logsDir } from '../../utils/paths.js';

type Level = 'info' | 'warn' | 'error' | 'debug';

export class Logger implements ILogger {
	private ring: string[] = [];
	private max = 500;
	private logFile: string | null = null;
	private currentBytes = 0;
	private diskQueue: Promise<void>;
	private readonly maxBytes: number;
	private readonly maxFiles: number;

	constructor(options: { maxBytes?: number; maxFiles?: number } = {}) {
		this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
		this.maxFiles = options.maxFiles ?? 3;
		if (this.maxBytes < 1 || !Number.isInteger(this.maxFiles) || this.maxFiles < 1) {
			throw new Error('logger retention limits must be positive');
		}
		this.diskQueue = this.init().catch(() => {
			/* ignore */
		});
	}

	private async init() {
		const dir = logsDir('namefix');
		await fsp.mkdir(dir, { recursive: true });
		this.logFile = path.join(dir, 'session.log');
		try {
			this.currentBytes = (await fsp.stat(this.logFile)).size;
		} catch {
			this.currentBytes = 0;
		}
		if (this.currentBytes >= this.maxBytes) await this.rotate();
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
		this.diskQueue = this.diskQueue
			.then(async () => this.writeLine(`${line}\n`))
			.catch(() => {
				/* logging must not terminate the daemon */
			});
		// Also echo human-readable to stdout for dev
		const human = `[${ts}] ${level.toUpperCase()} ${msg}`;
		if (level === 'error') console.error(human);
		else if (level === 'warn') console.warn(human);
		else console.log(human);
	}

	private async writeLine(line: string): Promise<void> {
		if (!this.logFile) return;
		const bytes = Buffer.byteLength(line);
		if (this.currentBytes > 0 && this.currentBytes + bytes > this.maxBytes) {
			await this.rotate();
		}
		await fsp.appendFile(this.logFile, line, 'utf8');
		this.currentBytes += bytes;
	}

	private async rotate(): Promise<void> {
		if (!this.logFile) return;
		if (this.maxFiles === 1) {
			await fsp.rm(this.logFile, { force: true });
			this.currentBytes = 0;
			return;
		}
		for (let index = this.maxFiles - 1; index >= 1; index--) {
			const source = index === 1 ? this.logFile : `${this.logFile}.${index - 1}`;
			const destination = `${this.logFile}.${index}`;
			await fsp.rm(destination, { force: true });
			try {
				await fsp.rename(source, destination);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
		}
		this.currentBytes = 0;
	}

	async flush(): Promise<void> {
		await this.diskQueue;
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
