import blessed from 'blessed';
import { BaseView } from '../BaseView.js';
import type { Theme } from '../ThemeManager.js';

export class HeaderView extends BaseView {
  private box!: blessed.Widgets.BoxElement;
  private dryRun = true;
  private theme!: Theme;

  mount(screen: blessed.Widgets.Screen): void {
    this.screen = screen;
    this.box = blessed.box({
      top: 0, left: 0, height: 3, width: '100%',
      tags: true, content: '',
      style: { fg: 'white', bg: 'blue' }
    });
    screen.append(this.box);
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    this.render();
  }

  setDryRun(dry: boolean) {
    this.dryRun = dry;
    this.render();
  }

  private render() {
    if (!this.box) return;
    const mode = this.dryRun ? '{yellow-fg}[DRY-RUN]{/yellow-fg}' : '{green-fg}[LIVE]{/green-fg}';
    this.box.setContent(` namefix  ${mode}`);
    const style: blessed.Widgets.BoxOptions['style'] = { fg: this.theme?.fg || 'white', bg: this.theme?.bg || 'black' };
    this.box.style = style;
    this.screen.render();
  }

  unmount(): void {
    this.box?.destroy();
  }
}
