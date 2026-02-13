import path from 'node:path';
import type { IConfig } from '../types/index.js';
import { NamefixService } from './NamefixService.js';
import { ScreenManager } from '../tui/ScreenManager.js';
import { SettingsModalView } from '../tui/components/SettingsModalView.js';

export type NamefixOverrides = Partial<{
	watchDir: string;
	prefix: string;
	include: string[];
	exclude: string[];
	dryRun: boolean;
	theme: string;
}>;

export class NamefixApp {
	private service: NamefixService | null = null;
	private ui: ScreenManager | null = null;
	private subscriptions: Array<() => void> = [];
	private currentConfig: IConfig | null = null;
	private lastStatus: { running: boolean; directories: string[]; dryRun: boolean } | null = null;

	async start(overrides?: NamefixOverrides): Promise<void> {
		this.service = new NamefixService();

		// 1. Screen appears INSTANTLY
		this.ui = new ScreenManager();
		this.ui.showToast('Starting...', 'info');

		// 2. Init config (fast disk I/O, typically <50ms)
		const cfg = await this.service.init(overrides);
		this.currentConfig = cfg;

		// 3. Register keybindings after config is ready (handlers depend on config)
		this.registerKeybindings();

		// 4. Apply config to UI
		if (cfg.theme) {
			this.ui.theme.set(cfg.theme);
			this.ui.applyTheme();
		}
		this.ui.setDryRun(cfg.dryRun);

		// 5. Wire events BEFORE start so we catch the initial status emit
		this.bindServiceEvents();

		// 6. Start watchers in background — don't block the UI
		this.service.start().catch(() => {
			this.ui?.showToast('Watcher startup failed', 'error');
		});
	}

	async stop(): Promise<void> {
		for (const off of this.subscriptions) {
			try {
				off();
			} catch {
				// ignore
			}
		}
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
					ui.addEvent({
						when,
						file: `${event.file}${directoryHint}`,
						target: event.target,
						status: event.kind,
					});
				} else if (event.kind === 'converted') {
					ui.addEvent({
						when,
						file: `${event.file}${directoryHint}`,
						target: event.target,
						status: 'converted',
					});
				} else if (event.kind === 'convert-error') {
					ui.addEvent({
						when,
						file: `${event.file}${directoryHint}`,
						status: 'convert-error',
						message: event.message,
					});
				} else if (event.kind === 'trashed') {
					ui.addEvent({
						when,
						file: `${event.file}${directoryHint}`,
						status: 'trashed',
					});
				} else {
					ui.addEvent({
						when,
						file: `${event.file}${directoryHint}`,
						status: event.kind === 'skipped' ? 'skipped' : 'error',
						message: event.message ?? undefined,
					});
				}
			}),
		);
		this.subscriptions.push(
			this.service.on('toast', ({ message, level }) => {
				ui.showToast(message, level);
			}),
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
			}),
		);
		this.subscriptions.push(
			this.service.on('config', (cfg) => {
				this.currentConfig = cfg;
				ui.setDryRun(cfg.dryRun);
				if (cfg.theme) {
					ui.theme.set(cfg.theme);
					ui.applyTheme();
				}
			}),
		);
	}

	private registerKeybindings() {
		if (!this.service || !this.ui) return;
		const service = this.service;
		const ui = this.ui;
		const screen = ui.screen;
		screen.key(['d'], async () => {
			const cfg = this.currentConfig ?? service.getConfig();
			const next = !cfg.dryRun;
			try {
				await service.setDryRun(next);
			} catch (err) {
				ui.showToast('Failed to toggle dry-run', 'error');
			}
		});

		screen.key(['u'], async () => {
			try {
				await service.undoLast();
			} catch {
				ui.showToast('Undo failed', 'error');
			}
		});

		screen.key(['s'], () => {
			this.openSettings();
		});
	}

	private openSettings() {
		if (!this.service || !this.ui || !this.currentConfig) return;
		const service = this.service;
		const ui = this.ui;
		const modal = new SettingsModalView();
		modal.mount(ui.screen);
		ui.setModalOpen(true);
		const config = this.currentConfig;
		const themes = ui.theme.names();
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
				theme: config.theme,
			},
			themes,
			async (next) => {
				ui.setModalOpen(false);
				try {
					const updates: Array<Promise<unknown>> = [];
					const normalizedNext = path.resolve(next.watchDir);
					const currentPrimary = config.watchDir ? path.resolve(config.watchDir) : null;
					const lacksPrimary = config.watchDirs.length === 0;
					const watchDirChanged = !currentPrimary || currentPrimary !== normalizedNext;
					if (watchDirChanged || lacksPrimary) {
						updates.push(service.setWatchDirs([normalizedNext]));
					}
					updates.push(
						service.setConfig({
							prefix: next.prefix,
							include: next.include,
							exclude: next.exclude,
							dryRun: next.dryRun,
							theme: next.theme,
						}),
					);
					await Promise.all(updates);
					ui.showToast('Settings saved', 'info');
				} catch {
					ui.showToast('Failed to save settings', 'error');
				}
			},
			() => {
				ui.setModalOpen(false);
			},
		);
	}
}
