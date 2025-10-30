import path from 'node:path';
import fs from 'node:fs/promises';
import type { IConfig, IConfigStore, IWatchService } from '../types/index.js';
import { ConfigStore } from './config/ConfigStore.js';
import { Logger } from './log/Logger.js';
import { EventBus } from './events/EventBus.js';
import { RenameService } from './rename/RenameService.js';
import { Matcher } from './rename/Matcher.js';
import { FsSafe } from './fs/FsSafe.js';
import { WatchService } from './fs/WatchService.js';
import { JournalStore } from './journal/JournalStore.js';
import type { ServiceEventMap, ServiceStatus } from '../types/service.js';
import { TypedEmitter } from '../utils/TypedEmitter.js';

/**
 * Shared orchestrator responsible for configuration, directory watching, and rename lifecycles.
 *
 * Emits typed events (`ServiceEventMap`) consumable by both the CLI/TUI and external front-ends.
 */
export class NamefixService {
  private emitter = new TypedEmitter<ServiceEventMap>();
  private configStore: IConfigStore;
  private logger: Logger;
  private eventBus: EventBus;
  private renamer: RenameService;
  private fsSafe: FsSafe;
  private journal: JournalStore;
  private matcher: Matcher | null = null;
  private watchers = new Map<string, IWatchService>();
  private running = false;
  private config: IConfig | null = null;
  private unsubscribeConfig: (() => void) | null = null;
  private watcherLock: Promise<void> = Promise.resolve();
  private createWatcher: (dir: string, fsSafe: FsSafe) => IWatchService;

  constructor(
    deps: {
      configStore?: IConfigStore;
      logger?: Logger;
      eventBus?: EventBus;
      fsSafe?: FsSafe;
      renamer?: RenameService;
      watcherFactory?: (dir: string, fsSafe: FsSafe) => IWatchService;
    } = {}
  ) {
    this.configStore = deps.configStore ?? new ConfigStore();
    this.logger = deps.logger ?? new Logger();
    this.eventBus = deps.eventBus ?? new EventBus();
    this.fsSafe = deps.fsSafe ?? new FsSafe();
    this.renamer = deps.renamer ?? new RenameService();
    this.journal = new JournalStore(this.fsSafe);
    this.createWatcher = deps.watcherFactory ?? ((dir, fsSafe) => new WatchService(dir, fsSafe));
  }

  async init(overrides?: Partial<IConfig>): Promise<IConfig> {
    let cfg = await this.configStore.get();
    if (overrides && Object.keys(overrides).length > 0) {
      cfg = await this.configStore.set({ ...overrides });
    }
    this.applyConfig(cfg);
    this.unsubscribeConfig = this.configStore.onChange((next) => {
      this.applyConfig(next);
      if (this.running) {
        this.syncWatchers().catch((err) => {
          this.logger.error(err instanceof Error ? err : String(err));
        });
      }
      this.emit('config', next);
      this.eventBus.emit('config:changed', { key: undefined });
    });
    return cfg;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.syncWatchers();
    this.emitStatus();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.syncWatchers();
    this.emitStatus();
  }

  async toggleRunning(): Promise<void> {
    if (this.running) await this.stop();
    else await this.start();
  }

  async setConfig(next: Partial<IConfig>): Promise<IConfig> {
    return await this.configStore.set(next);
  }

  async setDryRun(value: boolean): Promise<IConfig> {
    return await this.configStore.set({ dryRun: value });
  }

  async setLaunchOnLogin(value: boolean): Promise<IConfig> {
    return await this.configStore.set({ launchOnLogin: value });
  }

  async addWatchDir(dir: string): Promise<IConfig> {
    if (!dir || dir.trim().length === 0) return this.getConfig();
    const resolved = path.resolve(dir.trim());
    const cfg = this.getConfig();
    if (cfg.watchDirs.includes(resolved)) {
      if (cfg.watchDir !== resolved) {
        return await this.configStore.set({ watchDir: resolved });
      }
      return cfg;
    }
    const nextDirs = [...cfg.watchDirs, resolved];
    const primary = cfg.watchDir ?? resolved;
    return await this.configStore.set({ watchDirs: nextDirs, watchDir: primary });
  }

  async removeWatchDir(dir: string): Promise<IConfig> {
    if (!dir || dir.trim().length === 0) return this.getConfig();
    const resolved = path.resolve(dir.trim());
    const cfg = this.getConfig();
    const remaining = cfg.watchDirs.filter((d) => d !== resolved);
    const next: Partial<IConfig> = { watchDirs: remaining };
    if (cfg.watchDir === resolved) next.watchDir = remaining[0];
    return await this.configStore.set(next);
  }

  async setPrimaryWatchDir(dir: string): Promise<IConfig> {
    if (!dir || dir.trim().length === 0) return this.getConfig();
    const resolved = path.resolve(dir.trim());
    const cfg = this.getConfig();
    if (!cfg.watchDirs.includes(resolved)) {
      return await this.configStore.set({ watchDir: resolved, watchDirs: [resolved, ...cfg.watchDirs] });
    }
    return await this.configStore.set({ watchDir: resolved });
  }

  async setWatchDirs(dirs: string[]): Promise<IConfig> {
    const normalized = Array.from(new Set(dirs.filter(Boolean).map((d) => path.resolve(d.trim()))));
    if (!normalized.length) {
      return await this.configStore.set({ watchDirs: [] });
    }
    return await this.configStore.set({ watchDirs: normalized, watchDir: normalized[0] });
  }

  getConfig(): IConfig {
    if (!this.config) throw new Error('NamefixService not initialized');
    return this.config;
  }

  getStatus(): ServiceStatus {
    const cfg = this.getConfig();
    return { running: this.running, directories: this.getWatchDirs(cfg), dryRun: cfg.dryRun };
  }

  async undoLast(): Promise<{ ok: boolean; reason?: string }> {
    const res = await this.journal.undo();
    if (res.ok) {
      this.emit('toast', { level: 'info', message: 'Undo applied' });
    } else {
      this.emit('toast', { level: 'error', message: res.reason || 'Undo failed' });
    }
    return res;
  }

  /**
   * Subscribe to service events. Returns an unsubscribe handle for convenience.
   */
  on<K extends keyof ServiceEventMap>(event: K, listener: (event: ServiceEventMap[K]) => void): () => void {
    return this.emitter.on(event, listener);
  }

  private emit<K extends keyof ServiceEventMap>(event: K, payload: ServiceEventMap[K]) {
    this.emitter.emit(event, payload);
  }

  private async syncWatchers(): Promise<void> {
    await this.withWatcherLock(async () => {
      const cfg = this.getConfig();
      const desiredDirs = this.running ? this.getWatchDirs(cfg) : [];
      const desiredSet = new Set(desiredDirs);

      const stops: Array<Promise<void>> = [];
      for (const [dir, watcher] of this.watchers) {
        if (!desiredSet.has(dir)) {
          stops.push(this.stopWatcher(dir, watcher));
        }
      }
      if (stops.length) {
        await Promise.allSettled(stops);
      }

      if (!this.running || desiredDirs.length === 0) {
        if (!this.running) {
          this.logger.info('Watcher stopped');
        } else {
          this.logger.warn('No watch directories configured');
        }
        this.emitStatus();
        return;
      }

      for (const dir of desiredDirs) {
        if (this.watchers.has(dir)) continue;
        await this.startWatcher(dir);
      }
      this.emitStatus();
    });
  }

  private async startWatcher(dir: string): Promise<void> {
    await this.ensureDir(dir);
    const watcher = this.createWatcher(dir, this.fsSafe);
    this.watchers.set(dir, watcher);
    await watcher.start((ev) => {
      this.handleWatchEvent(dir, ev).catch((err) => {
        this.logger.error(err instanceof Error ? err : String(err));
      });
    });
  }

  private async stopWatcher(dir: string, watcher: IWatchService): Promise<void> {
    try {
      if (typeof watcher.stop === 'function') {
        await watcher.stop();
      }
    } catch (err) {
      this.logger.error(err instanceof Error ? err : String(err));
    }

    try {
      await watcher.dispose();
    } catch (err) {
      this.logger.error(err instanceof Error ? err : String(err));
    } finally {
      this.watchers.delete(dir);
    }
  }

  private async withWatcherLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.watcherLock;
    let release: () => void = () => {};
    this.watcherLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private applyConfig(cfg: IConfig) {
    this.config = cfg;
    this.matcher = new Matcher(cfg.include, cfg.exclude);
    this.emitStatus();
  }

  private async ensureDir(dir: string) {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private getWatchDirs(cfg: IConfig): string[] {
    const maybe = (cfg as any).watchDirs as string[] | undefined;
    if (Array.isArray(maybe) && maybe.length) return Array.from(new Set(maybe));
    return cfg.watchDir ? [cfg.watchDir] : [];
  }

  private async handleWatchEvent(directory: string, ev: { path: string; birthtimeMs: number; mtimeMs: number; size: number }) {
    if (!this.matcher) return;
    const cfg = this.getConfig();
    const basename = path.basename(ev.path);
    if (!this.matcher.test(basename)) return;
    const extVal = path.extname(ev.path);
    if (!this.renamer.needsRename(basename, cfg.prefix)) {
      this.emit('file', { kind: 'skipped', directory, file: basename, timestamp: Date.now(), message: 'idempotent' });
      return;
    }

    const targetBase = await this.renamer.targetFor(ev.path, { birthtime: new Date(ev.birthtimeMs), ext: extVal, prefix: cfg.prefix });
    const dir = path.dirname(ev.path);
    const targetPath = path.join(dir, targetBase);

    try {
      if (cfg.dryRun) {
        this.emit('file', { kind: 'preview', directory, file: basename, target: targetBase, timestamp: Date.now() });
        this.logger.info('preview', { from: ev.path, to: targetPath });
        return;
      }

      try {
        await this.fsSafe.atomicRename(ev.path, targetPath);
        await this.journal.record(ev.path, targetPath);
        this.emit('file', { kind: 'applied', directory, file: basename, target: targetBase, timestamp: Date.now() });
        this.eventBus.emit('file:renamed', { from: ev.path, to: targetPath });
      } catch (e: any) {
        const message = e?.message || 'rename failed';
        this.logger.error(e instanceof Error ? e : String(e));
        this.emit('file', { kind: 'error', directory, file: basename, timestamp: Date.now(), message });
        this.eventBus.emit('file:error', { path: ev.path, error: e });
      }
    } finally {
      this.renamer.release(dir, targetBase);
    }
  }

  private emitStatus() {
    if (!this.config) return;
    const dirs = this.getWatchDirs(this.config);
    this.emit('status', {
      running: this.running && this.watchers.size > 0,
      directories: dirs,
      dryRun: this.config.dryRun
    });
  }
}
