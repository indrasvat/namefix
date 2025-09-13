import path from 'node:path';

type Provider<T> = () => T;

export class Container {
  private singletons = new Map<string, unknown>();
  private providers = new Map<string, Provider<unknown>>();

  register<T>(token: string, provider: Provider<T>) {
    this.providers.set(token, provider as Provider<unknown>);
  }

  resolve<T>(token: string): T {
    if (this.singletons.has(token)) return this.singletons.get(token) as T;
    const provider = this.providers.get(token);
    if (!provider) throw new Error(`No provider for token: ${token}`);
    const instance = provider();
    this.singletons.set(token, instance);
    return instance as T;
  }
}

export class NamefixApp {
  private readonly container = new Container();
  private ui: any | null = null;
  private watcher: any | null = null;
  private matcher: any | null = null;

  async start(overrides?: Partial<{ watchDir: string; prefix: string; include: string[]; exclude: string[]; dryRun: boolean; theme: string }>): Promise<void> {
    // TODO: Replace with tsyringe and real registrations (Task 2/13)
    // Registrations kept minimal for now
    const { ConfigStore } = await import('./config/ConfigStore.js');
    const { Logger } = await import('./log/Logger.js');
    const { EventBus } = await import('./events/EventBus.js');
    this.container.register('ConfigStore', () => new ConfigStore());
    this.container.register('Logger', () => new Logger());
    this.container.register('EventBus', () => new EventBus());
    const { RenameService } = await import('./rename/RenameService.js');
    const { FsSafe } = await import('./fs/FsSafe.js');
    this.container.register('RenameService', () => new RenameService());
    this.container.register('FsSafe', () => new FsSafe());

    // Load config
    const configStore: any = this.container.resolve('ConfigStore');
    const logger: any = this.container.resolve('Logger');
    const eventBus: any = this.container.resolve('EventBus');
    let cfg = await configStore.get();
    if (overrides && Object.keys(overrides).length) {
      cfg = await configStore.set({ ...overrides });
    }

    // UI
    const { ScreenManager } = await import('../tui/ScreenManager.js');
    this.ui = new ScreenManager();
    // Apply persisted settings on startup (theme + dry-run)
    if (cfg?.theme) { this.ui.theme.set(cfg.theme); this.ui.applyTheme(); }
    this.ui.setDryRun(cfg.dryRun);
    this.ui.showToast(`Watching: ${cfg.watchDir} • Dry-run: ${cfg.dryRun ? 'On' : 'Off'}`, 'info');

    // Key bindings
    this.ui.screen.key(['d'], async () => {
      const next = !cfg.dryRun;
      cfg.dryRun = next;
      await configStore.set({ dryRun: next });
      this.ui.setDryRun(next);
      this.ui.showToast(next ? 'Dry-run enabled' : 'Live mode enabled', next ? 'warn' : 'info');
    });

    this.ui.screen.key(['u'], async () => {
      try {
        const { JournalStore } = await import('./journal/JournalStore');
        const fsSafe = this.container.resolve<any>('FsSafe');
        const journal = new JournalStore(fsSafe);
        const res = await journal.undo();
        this.ui.showToast(res.ok ? 'Undo applied' : `Undo failed: ${res.reason || ''}`, res.ok ? 'info' : 'error');
      } catch (e: any) {
        this.ui.showToast('Undo failed', 'error');
      }
    });

    // Watch + pipeline
    const { WatchService } = await import('./fs/WatchService.js');
    const { Matcher } = await import('./rename/Matcher.js');
    const { JournalStore } = await import('./journal/JournalStore.js');
    this.matcher = new Matcher(cfg.include, cfg.exclude);
    const fsSafe = this.container.resolve<any>('FsSafe');
    const renamer = this.container.resolve<any>('RenameService');
    const journal = new JournalStore(fsSafe);
    // Ensure watch dir exists
    const fsp = await import('node:fs/promises');
    try { await fsp.access(cfg.watchDir); } catch { try { await fsp.mkdir(cfg.watchDir, { recursive: true }); } catch {} }

    this.watcher = new WatchService(cfg.watchDir, fsSafe);

    await this.watcher.start(async (ev: any) => {
      const basename = path.basename(ev.path);
      if (!this.matcher.test(basename)) return;
      const extVal = path.extname(ev.path);
      // If already matches, skip
      if (!renamer.needsRename(basename, cfg.prefix)) {
        this.ui.addEvent({ when: new Date().toLocaleTimeString(), file: basename, status: 'skipped', message: 'idempotent' });
        return;
      }
      const targetBase = await renamer.targetFor(ev.path, { birthtime: new Date(ev.birthtimeMs), ext: extVal, prefix: cfg.prefix });
      const dir = path.dirname(ev.path);
      const targetPath = path.join(dir, targetBase);

      if (cfg.dryRun) {
        this.ui.addEvent({ when: new Date().toLocaleTimeString(), file: basename, target: targetBase, status: 'preview' });
        logger.info('preview', { from: ev.path, to: targetPath });
        return;
      }
      try {
        await fsSafe.atomicRename(ev.path, targetPath);
        await journal.record(ev.path, targetPath);
        this.ui.addEvent({ when: new Date().toLocaleTimeString(), file: basename, target: targetBase, status: 'applied' });
        eventBus.emit('file:renamed', { from: ev.path, to: targetPath });
      } catch (e: any) {
        logger.error(e);
        this.ui.addEvent({ when: new Date().toLocaleTimeString(), file: basename, status: 'error', message: e?.message || 'rename failed' });
        eventBus.emit('file:error', { path: ev.path, error: e });
      }
    });

    // Extra keybinds and hints
    this.ui.screen.key(['s'], async () => {
      try {
        const { SettingsModalView } = await import('../tui/components/SettingsModalView.js');
        const modal = new SettingsModalView();
        modal.mount(this.ui.screen);
        const themes = this.ui.theme.names();
        this.ui.setModalOpen(true);
        modal.open(cfg as any, themes, async (next) => {
        const oldWatch = cfg.watchDir;
        const oldInclude = cfg.include;
        const oldExclude = cfg.exclude;
        const oldPrefix = cfg.prefix;
        
        cfg = await configStore.set(next);
        
        // Apply live where possible
        this.ui.setDryRun(cfg.dryRun);
        if (next.theme) { this.ui.theme.set(next.theme); this.ui.applyTheme(); }
        
        // Update matcher if patterns changed
        if (JSON.stringify(oldInclude) !== JSON.stringify(cfg.include) || 
            JSON.stringify(oldExclude) !== JSON.stringify(cfg.exclude)) {
          const { Matcher } = await import('./rename/Matcher.js');
          this.matcher = new Matcher(cfg.include, cfg.exclude);
          this.ui.showToast('Watch patterns updated', 'info');
        }
        
        // Check if watch dir changed
        if (next.watchDir !== oldWatch) {
          // Stop old watcher and start new one
          try {
            const { WatchService } = await import('./fs/WatchService.js');
            await this.watcher.stop();
            this.watcher = new WatchService(cfg.watchDir, fsSafe);
            await this.watcher.start(async (ev: any) => {
              const basename = path.basename(ev.path);
              if (!this.matcher.test(basename)) return;
              const extVal = path.extname(ev.path);
              // If already matches, skip
              if (!renamer.needsRename(basename, cfg.prefix)) {
                this.ui.addEvent({ when: new Date().toLocaleTimeString(), file: basename, status: 'skipped', message: 'idempotent' });
                return;
              }
              const targetBase = await renamer.targetFor(ev.path, { birthtime: new Date(ev.birthtimeMs), ext: extVal, prefix: cfg.prefix });
              const dir = path.dirname(ev.path);
              const targetPath = path.join(dir, targetBase);

              if (cfg.dryRun) {
                this.ui.addEvent({ when: new Date().toLocaleTimeString(), file: basename, target: targetBase, status: 'preview' });
                logger.info('preview', { from: ev.path, to: targetPath });
                return;
              }
              try {
                await fsSafe.atomicRename(ev.path, targetPath);
                await journal.record(ev.path, targetPath);
                this.ui.addEvent({ when: new Date().toLocaleTimeString(), file: basename, target: targetBase, status: 'applied' });
                eventBus.emit('file:renamed', { from: ev.path, to: targetPath });
              } catch (e: any) {
                logger.error(e);
                this.ui.addEvent({ when: new Date().toLocaleTimeString(), file: basename, status: 'error', message: e?.message || 'rename failed' });
                eventBus.emit('file:error', { path: ev.path, error: e });
              }
            });
            this.ui.showToast(`Now watching: ${cfg.watchDir}`, 'info');
          } catch (e: any) {
            this.ui.showToast('Failed to update watch directory', 'error');
            logger.error('Failed to update watcher', e);
          }
        } else {
          this.ui.showToast('Settings saved', 'info');
        }
        
        this.ui.setModalOpen(false);
      }, () => { this.ui.setModalOpen(false); });
      } catch (e: any) {
        logger.error('Failed to open settings modal', e);
        this.ui.showToast('Failed to open settings', 'error');
      }
    });
  }

  async stop(): Promise<void> {
    // TODO: Tear down services
  }
}
