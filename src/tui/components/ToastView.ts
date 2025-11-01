import blessed from 'blessed';
import { BaseView } from '../BaseView.js';

export class ToastView extends BaseView {
  private box!: blessed.Widgets.BoxElement;
  private timer: NodeJS.Timeout | null = null;

  mount(screen: blessed.Widgets.Screen): void {
    this.screen = screen;
    this.box = blessed.box({
      bottom: 3, right: 1, width: 'shrink', height: 3, hidden: true,
      align: 'left', valign: 'middle', padding: { left: 1, right: 1 },
      style: { fg: 'black', bg: 'yellow' }
    });
    screen.append(this.box);
  }

  show(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (!this.box) return;
    this.box.setContent(msg);
    this.box.style = this.getStyleForLevel(level);
    this.box.show();
    this.screen.render();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.box.hide(); this.screen.render(); }, 2000);
  }

  private getStyleForLevel(level: 'info' | 'warn' | 'error'): blessed.Widgets.BoxOptions['style'] {
    if (level === 'error') {
      return { fg: 'white', bg: 'red' };
    }
    if (level === 'warn') {
      return { fg: 'black', bg: 'yellow' };
    }
    return { fg: 'black', bg: 'green' };
  }

  unmount(): void {
    if (this.timer) clearTimeout(this.timer);
    this.box?.destroy();
  }
}
