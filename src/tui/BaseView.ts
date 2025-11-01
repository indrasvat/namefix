import type blessed from 'blessed';

export abstract class BaseView {
  protected screen!: blessed.Widgets.Screen;
  abstract mount(screen: blessed.Widgets.Screen): void;
  abstract unmount(): void;
}

