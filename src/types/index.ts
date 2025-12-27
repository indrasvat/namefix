// Shared types and interfaces (Task 2)

export interface IDispose {
	dispose(): void | Promise<void>;
}

export type WatchEvent = {
	path: string;
	birthtimeMs: number;
	mtimeMs: number;
	size: number;
};

/**
 * A rename profile defines how files matching a pattern should be renamed.
 * Multiple profiles can be configured and are matched in priority order.
 */
export interface IProfile {
	/** Unique identifier for the profile */
	id: string;
	/** Human-readable name */
	name: string;
	/** Whether this profile is active */
	enabled: boolean;
	/** Glob pattern to match filenames (e.g., "Screenshot*", "IMG_*") */
	pattern: string;
	/** Whether pattern is a regex (true) or glob (false, default) */
	isRegex?: boolean;
	/** Rename template with variables like <date>, <time>, <original> */
	template: string;
	/** Optional prefix for the renamed file */
	prefix: string;
	/** Priority order (lower = higher priority, matched first) */
	priority: number;
}

export interface IConfig {
	watchDir: string;
	watchDirs: string[];
	/** @deprecated Use profiles instead. Kept for backwards compatibility. */
	prefix: string;
	/** @deprecated Use profiles instead. Kept for backwards compatibility. */
	include: string[];
	/** @deprecated Use profiles instead. Kept for backwards compatibility. */
	exclude: string[];
	dryRun: boolean;
	theme: string;
	launchOnLogin: boolean;
	/** Array of rename profiles. If empty, falls back to legacy prefix/include/exclude. */
	profiles: IProfile[];
}

export interface IConfigStore {
	get(): Promise<IConfig>;
	set(next: Partial<IConfig>): Promise<IConfig>;
	onChange(cb: (config: IConfig) => void): () => void;
}

export interface ILogger {
	info(msg: string, meta?: Record<string, unknown>): void;
	warn(msg: string, meta?: Record<string, unknown>): void;
	error(msg: string | Error, meta?: Record<string, unknown>): void;
	debug?(msg: string, meta?: Record<string, unknown>): void;
}

export interface IJournalStore extends IDispose {
	record(from: string, to: string): Promise<void>;
	undo(): Promise<{ ok: boolean; reason?: string }>;
}

export interface IRenameService {
	needsRename(filename: string, prefix: string): boolean;
	targetFor(
		srcPath: string,
		stat: { birthtime: Date; ext?: string; prefix?: string },
	): Promise<string> | string;
	release(dir: string, target: string): void;
}

export type WatchServiceErrorHandler = (error: Error, directory: string) => void;

export interface IWatchService extends IDispose {
	start(onAdd: (event: WatchEvent) => void): Promise<void>;
	stop?(): Promise<void> | void;
	/** Returns true if the watcher is healthy and actively watching */
	isHealthy?(): boolean;
	/** Register an error handler. Returns unsubscribe function. */
	onError?(handler: WatchServiceErrorHandler): () => void;
}
