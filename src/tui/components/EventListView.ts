import blessed from 'blessed';
import { BaseView } from '../BaseView.js';
import type { Theme } from '../ThemeManager.js';

export type UiEventItem = {
	when: string;
	file: string;
	target?: string;
	status: 'preview' | 'applied' | 'skipped' | 'error' | 'converted' | 'convert-error' | 'trashed';
	message?: string;
};

export class EventListView extends BaseView {
	private list!: blessed.Widgets.ListElement;
	private items: UiEventItem[] = [];
	private theme!: Theme;

	mount(screen: blessed.Widgets.Screen): void {
		this.screen = screen;
		this.list = blessed.list({
			top: 3,
			left: 0,
			bottom: 3,
			width: '100%',
			keys: true,
			vi: true,
			mouse: true,
			interactive: true,
			scrollable: true,
			items: [],
			tags: true,
			style: { selected: { bg: 'blue' } },
		});
		screen.append(this.list);
	}

	setTheme(theme: Theme) {
		this.theme = theme;
		this.render();
	}

	addItem(item: UiEventItem) {
		this.items.unshift(item);
		if (this.items.length > 500) this.items.pop();
		this.render();
	}

	private render() {
		if (!this.list) return;
		const lines = this.items.map((e) => this.formatItem(e));
		this.list.setItems(lines);
		this.screen.render();
	}

	private formatItem(e: UiEventItem): string {
		const color =
			e.status === 'applied'
				? 'green'
				: e.status === 'converted'
					? 'cyan'
					: e.status === 'preview'
						? 'yellow'
						: e.status === 'skipped' || e.status === 'trashed'
							? 'gray'
							: 'red';
		const status = `{${color}-fg}${e.status.toUpperCase()}{/${color}-fg}`;
		const tgt = e.target ? ` → ${e.target}` : '';
		return `${e.when}  ${status}  ${e.file}${tgt}`;
	}

	unmount(): void {
		this.list?.destroy();
	}
}
