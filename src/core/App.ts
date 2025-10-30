import path from 'node:path';
import type { IConfig } from '../types/index.js';
import { NamefixService } from './NamefixService.js';
import { ScreenManager } from '../tui/ScreenManager.js';
import { SettingsModalView } from '../tui/components/SettingsModalView.js';

type Overrides = Partial<{ watchDir: string; prefix: string; include: string[]; exclude: string[]; dryRun: boolean; theme: string }>;

export class NamefixApp {
  private service: NamefixService | null = null;
  private ui: ScreenManager | null = null;
  private subscriptions: Array<() => void> = [];
  private currentConfig: IConfig | null = null;
  private lastStatus: { running: boolean; directories: string[]; dryRun: boolean } | null = null;

  async start(overrides?: Overrides): Promise<void> {
    this.service = new NamefixService();
    const cfg = await this.service.init(overrides);
    this.currentConfig = cfg;

    this.ui = new ScreenManager();
    if (cfg.theme) {
      this.ui.theme.set(cfg.theme);
      this.ui.applyTheme();
    }
    this.ui.setDryRun(cfg.dryRun);
    this.ui.showToast(`Ready • Dry-run: ${cfg.dryRun ? 'On' : 'Off'}`, 'info');

    this.bindServiceEvents();
    await this.service.start();
    this.registerKeybindings();
  }

  async stop(): Promise<void> {
    this.subscriptions.forEach((off) => {
      try { off(); } catch { /* ignore */ }
    });
    this.subscriptions = [];
    if (this.service) {
      await this.service.stop();
    }
  }

  private bindServiceEvents() {
    if (!this.service || !this.ui) return;
    const ui = this.ui;
    this.subscriptions.push(
      this.service.on('file', (event) => {
        const when = new Date(event.timestamp).toLocaleTimeString();
        const directoryHint = event.directory ? ` (${path.basename(event.directory)})` : '';
        if (event.kind === 'preview' || event.kind === 'applied') {
          ui.addEvent({ when, file: `${event.file}${directoryHint}`, target: event.target, status: event.kind });
        } else {
          ui.addEvent({
            when,
            file: `${event.file}${directoryHint}`,
            status: event.kind === 'skipped' ? 'skipped' : 'error',
            message: event.kind === 'error' ? event.message : event.message ?? undefined
          });
        }
      })
    );
    this.subscriptions.push(
      this.service.on('toast', ({ message, level }) => {
        ui.showToast(message, level);
      })
    );
    this.subscriptions.push(
      this.service.on('status', (status) => {
        const prev = this.lastStatus;
        this.lastStatus = status;
        ui.setDryRun(status.dryRun);
        const dirsLabel = status.directories.join(', ') || '—';
        const changedRunning = !prev || prev.running !== status.running;
        const changedDirs = !prev || dirsLabel !== prev.directories.join(', ');
        if (changedRunning || changedDirs) {
          if (status.running) ui.showToast(`Watching ${dirsLabel}`, 'info');
          else ui.showToast('Watcher paused', 'warn');
        }
      })
    );
    this.subscriptions.push(
      this.service.on('config', (cfg) => {
        this.currentConfig = cfg;
        ui.setDryRun(cfg.dryRun);
        if (cfg.theme) {
          ui.theme.set(cfg.theme);
          ui.applyTheme();
        }
      })
    );
  }

  private registerKeybindings() {
    if (!this.service || !this.ui) return;
    const screen = this.ui.screen;
    screen.key(['d'], async () => {
      const cfg = this.currentConfig ?? this.service!.getConfig();
      const next = !cfg.dryRun;
      try {
        await this.service!.setDryRun(next);
      } catch (err) {
        this.ui?.showToast('Failed to toggle dry-run', 'error');
      }
    });

    screen.key(['u'], async () => {
      try {
        await this.service!.undoLast();
      } catch {
        this.ui?.showToast('Undo failed', 'error');
      }
    });

    screen.key(['s'], () => {
      this.openSettings();
    });
  }

  private openSettings() {
    if (!this.service || !this.ui || !this.currentConfig) return;
    const modal = new SettingsModalView();
    modal.mount(this.ui.screen);
    this.ui.setModalOpen(true);
    const config = this.currentConfig;
    const themes = this.ui.theme.names();
    let primaryDir = config.watchDir;
    if (!primaryDir || primaryDir.trim().length === 0) {
      primaryDir = config.watchDirs[0] ?? '';
    }
    modal.open(
      {
        watchDir: primaryDir,
        prefix: config.prefix,
        include: config.include,
        exclude: config.exclude,
        dryRun: config.dryRun,
        theme: config.theme
      },
      themes,
      async (next) => {
        this.ui?.setModalOpen(false);
        try {
          const updates: Array<Promise<unknown>> = [];
          const normalizedNext = path.resolve(next.watchDir);
          const currentPrimary = config.watchDir ? path.resolve(config.watchDir) : null;
          const lacksPrimary = config.watchDirs.length === 0;
          const watchDirChanged = !currentPrimary || currentPrimary !== normalizedNext;
          if (watchDirChanged || lacksPrimary) {
            updates.push(this.service!.setWatchDirs([normalizedNext]));
          }
          updates.push(
            this.service!.setConfig({
              prefix: next.prefix,
              include: next.include,
              exclude: next.exclude,
              dryRun: next.dryRun,
              theme: next.theme
            })
          );
          await Promise.all(updates);
          this.ui?.showToast('Settings saved', 'info');
        } catch {
          this.ui?.showToast('Failed to save settings', 'error');
        }
      },
      () => {
        this.ui?.setModalOpen(false);
      }
    );
  }
}
