import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { IConfig, IConfigStore, IWatchService, WatchEvent } from '../types/index.js';
import type { ServiceStatus, ServiceFileEvent } from '../types/service.js';
import { NamefixService } from './NamefixService.js';

class MemoryConfigStore implements IConfigStore {
  private cfg: IConfig;
  private listeners = new Set<(config: IConfig) => void>();

  constructor(initial: IConfig) {
    this.cfg = { ...initial, watchDirs: [...initial.watchDirs], include: [...initial.include], exclude: [...initial.exclude] };
  }

  async get(): Promise<IConfig> {
    return this.clone();
  }

  async set(next: Partial<IConfig>): Promise<IConfig> {
    if (next.watchDirs) {
      this.cfg.watchDirs = [...next.watchDirs];
      if (!next.watchDir && this.cfg.watchDirs.length > 0) {
        this.cfg.watchDir = this.cfg.watchDirs[0]!;
      }
    }
    this.cfg = { ...this.cfg, ...next };
    if (!this.cfg.watchDir && this.cfg.watchDirs.length > 0) {
      this.cfg.watchDir = this.cfg.watchDirs[0]!;
    }
    const snapshot = this.clone();
    this.listeners.forEach((cb) => cb(snapshot));
    return snapshot;
  }

  onChange(cb: (config: IConfig) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private clone(): IConfig {
    return {
      ...this.cfg,
      watchDirs: [...this.cfg.watchDirs],
      include: [...this.cfg.include],
      exclude: [...this.cfg.exclude]
    };
  }
}

class StubWatcher implements IWatchService {
  readonly start = vi.fn(async (handler: (event: WatchEvent) => void) => {
    this.handler = handler;
  });
  readonly stop = vi.fn(async () => {
    this.stopped = true;
  });
  readonly dispose = vi.fn(async () => {
    this.disposed = true;
  });
  handler: ((event: WatchEvent) => void) | null = null;
  stopped = false;
  disposed = false;

  trigger(event: WatchEvent) {
    this.handler?.(event);
  }
}

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

const baseConfig = (): IConfig => ({
  watchDir: '',
  watchDirs: [],
  prefix: 'Screenshot',
  include: ['Screenshot*'],
  exclude: [],
  dryRun: true,
  theme: 'default',
  launchOnLogin: false
});

describe('NamefixService', () => {
  let tempRoot: string;
  let configStore: MemoryConfigStore;
  const watchers = new Map<string, StubWatcher>();
  let createdDirs: string[] = [];

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'namefix-service-'));
    process.env.NAMEFIX_HOME = path.join(tempRoot, 'config');
    process.env.NAMEFIX_LOGS = path.join(tempRoot, 'logs');
    watchers.clear();
    createdDirs = [];
    const dirA = await fs.mkdtemp(path.join(tempRoot, 'watch-a-'));
    const dirB = await fs.mkdtemp(path.join(tempRoot, 'watch-b-'));
    configStore = new MemoryConfigStore({
      ...baseConfig(),
      watchDir: dirA,
      watchDirs: [dirA, dirB]
    });
  });

  afterEach(async () => {
    delete process.env.NAMEFIX_HOME;
    delete process.env.NAMEFIX_LOGS;
    await fs.rm(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function createService() {
    return new NamefixService({
      configStore,
      logger: noopLogger as any,
      watcherFactory: (dir) => {
        const watcher = new StubWatcher();
        watchers.set(dir, watcher);
        createdDirs.push(dir);
        return watcher;
      }
    });
  }

  it('starts watchers for all configured directories and emits running status', async () => {
    const service = createService();
    const initialConfig = await configStore.get();
    const statuses: ServiceStatus[] = [];
    service.on('status', (status) => statuses.push(status));

    await service.init();
    await service.start();

    expect(watchers.size).toBe(2);
    for (const watcher of watchers.values()) {
      expect(watcher.start).toHaveBeenCalledTimes(1);
    }
    expect(statuses.pop()).toMatchObject({
      running: true,
      directories: initialConfig.watchDirs,
      dryRun: initialConfig.dryRun
    });
  });

  it('synchronises watchers when directories change', async () => {
    const service = createService();
    await service.init();
    await service.start();

    const [firstDir] = Array.from(watchers.keys());
    expect(firstDir).toBeDefined();
    const previousWatcher = watchers.get(firstDir!)!;

    const newDir = await fs.mkdtemp(path.join(tempRoot, 'watch-c-'));
    const statusUpdates: ServiceStatus[] = [];
    service.on('status', (status) => statusUpdates.push(status));

    await service.setWatchDirs([newDir]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(previousWatcher.stop).toHaveBeenCalledTimes(1);
    expect(previousWatcher.dispose).toHaveBeenCalledTimes(1);
    expect(createdDirs.filter((dir) => dir === newDir).length).toBe(1);
    const newWatcher = watchers.get(newDir);
    if (newWatcher) {
      expect(newWatcher.start).toHaveBeenCalledTimes(1);
    }
    expect(statusUpdates.pop()).toMatchObject({
      directories: [newDir],
      running: true
    });
  });

  it('forwards file events through the service emitter', async () => {
    const service = createService();
    await service.init();
    await service.start();

    const dir = Array.from(watchers.keys())[0];
    expect(dir).toBeDefined();
    const watcher = watchers.get(dir!)!;

    const events: ServiceFileEvent[] = [];
    service.on('file', (event) => events.push(event));

    watcher.trigger({
      path: path.join(dir!, 'Screenshot 2025-10-30 at 09.00.00.png'),
      birthtimeMs: Date.now(),
      mtimeMs: Date.now(),
      size: 10
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('preview');
  });

  it('stops watchers when service stops', async () => {
    const service = createService();
    await service.init();
    await service.start();

    await service.stop();

    for (const watcher of watchers.values()) {
      expect(watcher.stop).toHaveBeenCalled();
      expect(watcher.dispose).toHaveBeenCalled();
    }
  });
});
