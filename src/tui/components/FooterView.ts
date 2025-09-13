import blessed from 'blessed';
import { BaseView } from '../BaseView.js';

export class FooterView extends BaseView {
  private box!: blessed.Widgets.BoxElement;

  mount(screen: blessed.Widgets.Screen): void {
    this.screen = screen;
    this.box = blessed.box({
      bottom: 0, left: 0, height: 3, width: '100%',
      tags: true, content: ' q Quit  d Toggle Dry‑run  u Undo  s Settings',
      style: { fg: 'gray', bg: 'black' }
    });
    screen.append(this.box);
  }

  unmount(): void { this.box?.destroy(); }
}

