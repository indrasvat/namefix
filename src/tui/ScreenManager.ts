import blessed from 'blessed';
import { HeaderView } from './components/HeaderView.js';
import { EventListView, UiEventItem } from './components/EventListView.js';
import { FooterView } from './components/FooterView.js';
import { ToastView } from './components/ToastView.js';
import { ThemeManager } from './ThemeManager.js';

export class ScreenManager {
  screen: blessed.Widgets.Screen;
  header = new HeaderView();
  list = new EventListView();
  footer = new FooterView();
  toast = new ToastView();
  theme = new ThemeManager();
  dryRun = true;
  private modalOpen = false;

  setModalOpen(v: boolean) { this.modalOpen = v; }

  constructor() {
    this.screen = blessed.screen({ smartCSR: true, title: 'namefix', mouse: true });
    this.header.mount(this.screen);
    this.list.mount(this.screen);
    this.footer.mount(this.screen);
    this.toast.mount(this.screen);
    this.applyTheme();

    // Quit handling: respect modal overlays
    this.screen.key(['q'], () => {
      if (this.modalOpen) return; // let modal handle 'q'
      process.exit(0);
    });
    this.screen.key(['C-c'], () => process.exit(0));
  }

  setDryRun(d: boolean) { this.dryRun = d; this.header.setDryRun(d); }
  addEvent(item: UiEventItem) { this.list.addItem(item); }
  showToast(msg: string, level: 'info' | 'warn' | 'error' = 'info') { this.toast.show(msg, level); }

  applyTheme() {
    const t = this.theme.get();
    this.header.setTheme(t);
    this.list.setTheme?.(t as any);
    this.screen.render();
  }
}
