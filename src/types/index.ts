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

export interface IConfig {
  watchDir: string;
  prefix: string;
  include: string[];
  exclude: string[];
  dryRun: boolean;
  theme: string;
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
  targetFor(srcPath: string, stat: { birthtime: Date; ext?: string; prefix?: string }): Promise<string> | string;
  release(dir: string, target: string): void;
}

export interface IWatchService extends IDispose {
  start(onAdd: (event: WatchEvent) => void): Promise<void>;
}
