import blessed from 'blessed';
import { BaseView } from '../BaseView.js';
import type { Theme } from '../ThemeManager.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

type Settings = {
  watchDir: string;
  prefix: string;
  include: string[];
  exclude: string[];
  dryRun: boolean;
  theme: string;
};

export class SettingsModalView extends BaseView {
  private modal!: blessed.Widgets.BoxElement;
  private form!: blessed.Widgets.FormElement<any>;
  private onSubmitCb: ((s: Settings) => void) | null = null;
  private onCancelCb: (() => void) | null = null;

  // Form inputs
  private watchDirInput!: blessed.Widgets.TextboxElement;
  private prefixInput!: blessed.Widgets.TextboxElement;
  private includeInput!: blessed.Widgets.TextboxElement;
  private excludeInput!: blessed.Widgets.TextboxElement;
  private dryRunCheckbox!: blessed.Widgets.CheckboxElement;
  private themeList!: blessed.Widgets.ListElement;
  private saveBtn!: blessed.Widgets.ButtonElement;
  private cancelBtn!: blessed.Widgets.ButtonElement;

  mount(screen: blessed.Widgets.Screen): void {
    this.screen = screen;
  }

  open(initial: Settings, themes: string[], onSubmit: (s: Settings) => void, onCancel: () => void) {
    this.onSubmitCb = onSubmit;
    this.onCancelCb = onCancel;

    // Create modal container with high z-index
    this.modal = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 70,
      height: 30,
      border: 'line',
      label: ' Settings ',
      tags: true,
      keys: true,
      mouse: true,
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'cyan', bold: true },
        bg: 'black',
        focus: {
          border: { fg: 'yellow' }
        }
      }
    });

    // Create form as child of modal
    this.form = blessed.form({
      parent: this.modal,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      keys: true,
      mouse: true,
      vi: false
    });

    // Define styles
    const labelStyle = { fg: 'white', bold: true };
    const inputStyle = {
      fg: 'white',
      bg: 'black',
      border: { fg: 'gray' },
      focus: {
        fg: 'black',
        bg: 'white',
        border: { fg: 'cyan' }
      }
    };

    let yPos = 1;

    // Watch Directory input
    blessed.text({
      parent: this.form,
      left: 2,
      top: yPos,
      content: 'Watch Dir:',
      style: labelStyle
    });
    this.watchDirInput = blessed.textbox({
      parent: this.form,
      name: 'watchDir',
      left: 14,
      top: yPos,
      width: 42,
      height: 3,
      border: 'line',
      keys: true,
      mouse: true,
      value: this.expandPath(initial.watchDir),
      style: inputStyle
    });
    // Use readInput on focus instead of inputOnFocus
    this.watchDirInput.on('focus', () => {
      this.watchDirInput.readInput();
    });
    yPos += 4;

    // Prefix input
    blessed.text({
      parent: this.form,
      left: 2,
      top: yPos,
      content: 'Prefix:',
      style: labelStyle
    });
    this.prefixInput = blessed.textbox({
      parent: this.form,
      name: 'prefix',
      left: 14,
      top: yPos,
      width: 42,
      height: 3,
      border: 'line',
      keys: true,
      mouse: true,
      value: initial.prefix,
      style: inputStyle
    });
    this.prefixInput.on('focus', () => {
      this.prefixInput.readInput();
    });
    yPos += 4;

    // Include patterns input
    blessed.text({
      parent: this.form,
      left: 2,
      top: yPos,
      content: 'Include:',
      style: labelStyle
    });
    this.includeInput = blessed.textbox({
      parent: this.form,
      name: 'include',
      left: 14,
      top: yPos,
      width: 42,
      height: 3,
      border: 'line',
      keys: true,
      mouse: true,
      value: initial.include.join(', '),
      style: inputStyle
    });
    this.includeInput.on('focus', () => {
      this.includeInput.readInput();
    });
    yPos += 4;

    // Exclude patterns input
    blessed.text({
      parent: this.form,
      left: 2,
      top: yPos,
      content: 'Exclude:',
      style: labelStyle
    });
    this.excludeInput = blessed.textbox({
      parent: this.form,
      name: 'exclude',
      left: 14,
      top: yPos,
      width: 42,
      height: 3,
      border: 'line',
      keys: true,
      mouse: true,
      value: initial.exclude.join(', '),
      style: inputStyle
    });
    this.excludeInput.on('focus', () => {
      this.excludeInput.readInput();
    });
    yPos += 4;

    // Dry Run checkbox
    blessed.text({
      parent: this.form,
      left: 2,
      top: yPos,
      content: 'Dry Run:',
      style: labelStyle
    });
    this.dryRunCheckbox = blessed.checkbox({
      parent: this.form,
      name: 'dryRun',
      left: 14,
      top: yPos,
      checked: initial.dryRun,
      keys: true,
      mouse: true,
      text: 'Enabled',
      style: {
        fg: 'white',
        focus: {
          fg: 'cyan',
          bold: true
        }
      }
    });
    yPos += 3;

    // Theme list
    blessed.text({
      parent: this.form,
      left: 2,
      top: yPos,
      content: 'Theme:',
      style: labelStyle
    });
    // Create a properly formatted list with clean items
    const themeItems = themes.map(t => t);  // Ensure clean strings

    this.themeList = blessed.list({
      parent: this.form,
      name: 'theme',
      left: 14,
      top: yPos,
      width: 35,
      height: 7,
      border: 'line',
      keys: true,
      mouse: true,
      vi: false,
      scrollable: true,
      alwaysScroll: false,
      scrollbar: {
        ch: ' '
      },
      items: themeItems,
      interactive: true,
      style: {
        bg: 'black',
        fg: 'white',
        border: { fg: 'gray' },
        selected: {
          bg: 'blue',
          fg: 'white',
          bold: true
        },
        focus: {
          border: { fg: 'cyan' }
        },
        item: {
          fg: 'white',
          bg: 'black'
        }
      }
    });
    const idx = Math.max(0, themes.indexOf(initial.theme));
    this.themeList.select(idx);
    yPos += 8;

    // Footer hint - removed to avoid overlap issues

    // Save and Cancel buttons
    this.saveBtn = blessed.button({
      parent: this.form,
      left: 18,
      bottom: 2,
      shrink: true,
      mouse: true,
      keys: true,
      padding: {
        left: 1,
        right: 1
      },
      content: '  Save  ',
      style: {
        bg: 'green',
        fg: 'black',
        bold: true,
        focus: {
          bg: 'cyan',
          fg: 'black'
        },
        hover: {
          bg: 'cyan',
          fg: 'black'
        }
      }
    });

    this.cancelBtn = blessed.button({
      parent: this.form,
      left: 32,
      bottom: 2,
      shrink: true,
      mouse: true,
      keys: true,
      padding: {
        left: 1,
        right: 1
      },
      content: ' Cancel ',
      style: {
        bg: 'red',
        fg: 'white',
        bold: true,
        focus: {
          bg: 'magenta',
          fg: 'white'
        },
        hover: {
          bg: 'magenta',
          fg: 'white'
        }
      }
    });

    // Button event handlers - delegate to form
    this.saveBtn.on('press', () => {
      this.form.submit();
    });

    this.cancelBtn.on('press', () => {
      this.form.cancel();
    });

    // Form submit/cancel handlers
    this.form.on('submit', () => {
      this.handleSubmit();
    });

    this.form.on('cancel', () => {
      this.close(false);
    });

    // Modal-level key handlers
    this.modal.key(['escape'], () => {
      this.form.cancel();
    });

    this.modal.key(['C-s'], () => {
      this.form.submit();
    });

    // Handle Enter key in textboxes - submit the value and move to next field
    const textboxes = [this.watchDirInput, this.prefixInput, this.includeInput, this.excludeInput];
    textboxes.forEach((textbox, index) => {
      textbox.on('submit', () => {
        // Move to next field
        if (index < textboxes.length - 1) {
          const nextTextbox = textboxes[index + 1];
          if (nextTextbox) {
            nextTextbox.focus();
          }
        } else {
          this.dryRunCheckbox.focus();
        }
        this.screen.render();
      });
    });

    // Tab navigation using form's built-in focus management
    this.form.key(['tab'], () => {
      this.form.focusNext();
      this.screen.render();
    });

    this.form.key(['S-tab'], () => {
      this.form.focusPrevious();
      this.screen.render();
    });

    // Ensure modal is on top and visible
    this.modal.setFront();
    this.modal.focus();

    // Focus first input
    this.watchDirInput.focus();

    // Force screen render
    this.screen.render();
  }

  private handleSubmit() {
    // Gather values from form
    const watchDir = this.watchDirInput.getValue().trim();
    const prefix = this.prefixInput.getValue().trim();
    const includeStr = this.includeInput.getValue().trim();
    const excludeStr = this.excludeInput.getValue().trim();
    const dryRun = this.dryRunCheckbox.checked;

    // Debug logging
    if (process.env.DEBUG_SETTINGS) {
      console.error('[Settings] Submit triggered');
      console.error('[Settings] Values:', { watchDir, prefix, includeStr, excludeStr, dryRun });
    }

    // Get selected theme
    const selIdx = (this.themeList as any).selected as number;
    const theme = String(this.themeList.getItem(selIdx)?.content || '').trim() || 'default';

    // Parse include/exclude patterns
    const include = includeStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const exclude = excludeStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Validate watch dir
    if (!watchDir) {
      // Show error by flashing the border
      const origBorder = this.watchDirInput.style.border;
      this.watchDirInput.style.border = { fg: 'red' };
      this.screen.render();
      setTimeout(() => {
        this.watchDirInput.style.border = origBorder;
        this.screen.render();
      }, 500);
      this.watchDirInput.focus();
      return;
    }

    // Expand path if it contains ~
    const expandedPath = this.expandPath(watchDir);

    const settings: Settings = {
      watchDir: expandedPath,
      prefix: prefix || 'Screenshot',
      include: include.length > 0 ? include : ['Screenshot*'],
      exclude,
      dryRun,
      theme
    };

    this.onSubmitCb && this.onSubmitCb(settings);
    this.close(true);
  }

  private expandPath(p: string): string {
    if (p.startsWith('~')) {
      return path.join(os.homedir(), p.slice(1));
    }
    return p;
  }

  private close(saved: boolean) {
    if (process.env.DEBUG_SETTINGS) {
      console.error('[Settings] Closing modal, saved:', saved);
    }
    if (this.modal) {
      this.modal.destroy();
      this.modal = null as any;
    }
    this.screen.render();
    if (!saved && this.onCancelCb) {
      this.onCancelCb();
    }
  }

  unmount(): void {
    if (this.modal) {
      this.modal.destroy();
      this.modal = null as any;
    }
  }
}