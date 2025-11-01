import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type ServiceStatus = {
  running: boolean;
  directories: string[];
  dryRun: boolean;
  launchOnLogin: boolean;
};

type ToastPayload = {
  message: string;
  level: 'info' | 'warn' | 'error';
};

const statusSummary = document.querySelector<HTMLParagraphElement>('#status-summary');
const statusOutput = document.querySelector<HTMLPreElement>('#status');
const directoriesList = document.querySelector<HTMLUListElement>('#directories');
const toggleButton = document.querySelector<HTMLButtonElement>('#toggle-running');
const dryRunToggle = document.querySelector<HTMLInputElement>('#dry-run-toggle');
const launchToggle = document.querySelector<HTMLInputElement>('#launch-login-toggle');
const undoButton = document.querySelector<HTMLButtonElement>('#undo-button');
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-button');
const addDirectoryForm = document.querySelector<HTMLFormElement>('#add-directory-form');
const addDirectoryInput = document.querySelector<HTMLInputElement>('#new-directory');
const toastContainer = document.querySelector<HTMLDivElement>('#toast');
const metricRunning = document.querySelector<HTMLSpanElement>('#metric-running');
const metricDirectories = document.querySelector<HTMLSpanElement>('#metric-directories');
const metricDryRun = document.querySelector<HTMLSpanElement>('#metric-dry-run');
const metricLaunch = document.querySelector<HTMLSpanElement>('#metric-launch');
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab-target]'));
const tabViews = Array.from(document.querySelectorAll<HTMLElement>('[data-tab]'));

let currentStatus: ServiceStatus | null = null;
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function activateTab(name: string) {
  for (const button of tabButtons) {
    button.classList.toggle('active', button.dataset.tabTarget === name);
  }
  for (const view of tabViews) {
    view.classList.toggle('active', view.dataset.tab === name);
  }
}

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    const target = button.dataset.tabTarget ?? 'overview';
    activateTab(target);
  });
}

if (tabButtons.length && tabViews.length) {
  activateTab('overview');
}

function formatSummary(status: ServiceStatus): string {
  const dirCount = status.directories.length;
  const dirLabel = dirCount === 1 ? 'directory' : 'directories';
  const dry = status.dryRun ? ' • dry run' : '';
  if (!dirCount) {
    return status.running ? `Watching • no directories${dry}` : `Paused • add a directory${dry}`;
  }
  return status.running
    ? `Watching • ${dirCount} ${dirLabel}${dry}`
    : `Paused • ${dirCount} ${dirLabel}${dry}`;
}

function showToast(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  if (!toastContainer) return;
  toastContainer.textContent = message;
  toastContainer.dataset.level = level;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastContainer.textContent = '';
    delete toastContainer.dataset.level;
  }, 4000);
}

function renderDirectories(status: ServiceStatus) {
  if (!directoriesList) return;
  directoriesList.innerHTML = '';

  if (!status.directories.length) {
    const empty = document.createElement('li');
    empty.className = 'directory-item';
    empty.textContent = 'No directories configured yet';
    directoriesList.appendChild(empty);
    return;
  }

  for (const directory of status.directories) {
    const item = document.createElement('li');
    item.className = 'directory-item';

    const text = document.createElement('div');
    text.className = 'directory-text';

    const chip = document.createElement('span');
    chip.className = 'directory-chip';
    const sanitized = directory.replace(/[/\\]+$/, '');
    const segments = sanitized.split(/[/\\]/).filter(Boolean);
    const baseName = segments.length ? segments[segments.length - 1] : directory;
    chip.textContent = baseName || '/';

    const label = document.createElement('span');
    label.className = 'directory-path';
    label.textContent = directory;

    text.append(chip, label);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'button-ghost';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', async () => {
      removeButton.disabled = true;
      try {
        await invoke('remove_watch_dir', { directory });
        showToast(`Removed ${directory}`, 'info');
      } catch (error: unknown) {
        showToast(
          `Failed to remove directory: ${error instanceof Error ? error.message : String(error)}`,
          'error'
        );
        removeButton.disabled = false;
      }
    });

    item.append(text, removeButton);
    directoriesList.appendChild(item);
  }
}

function renderStatus(status: ServiceStatus) {
  currentStatus = status;
  if (statusSummary) statusSummary.textContent = formatSummary(status);
  if (statusOutput) statusOutput.textContent = JSON.stringify(status, null, 2);
  if (toggleButton) toggleButton.textContent = status.running ? 'Pause Watching' : 'Start Watching';
  if (dryRunToggle) dryRunToggle.checked = status.dryRun;
  if (launchToggle) launchToggle.checked = status.launchOnLogin;
  if (metricRunning) {
    metricRunning.textContent = status.running ? 'Watching' : 'Paused';
    metricRunning.dataset.state = status.running ? 'accent' : 'muted';
  }
  if (metricDirectories) {
    metricDirectories.textContent = String(status.directories.length);
    metricDirectories.dataset.state = status.directories.length ? 'active' : 'muted';
  }
  if (metricDryRun) {
    metricDryRun.textContent = status.dryRun ? 'Enabled' : 'Disabled';
    metricDryRun.dataset.state = status.dryRun ? 'warn' : 'muted';
  }
  if (metricLaunch) {
    metricLaunch.textContent = status.launchOnLogin ? 'Enabled' : 'Disabled';
    metricLaunch.dataset.state = status.launchOnLogin ? 'active' : 'muted';
  }
  renderDirectories(status);
}

async function refreshStatus() {
  try {
    const status = await invoke<ServiceStatus>('get_status');
    renderStatus(status);
  } catch (error: unknown) {
    showToast(`Failed to fetch status: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

async function toggleRunning() {
  if (!currentStatus) return;
  toggleButton?.setAttribute('disabled', 'true');
  try {
    await invoke<ServiceStatus>('toggle_running', { desired: !currentStatus.running });
  } catch (error: unknown) {
    showToast(`Failed to toggle watcher: ${error instanceof Error ? error.message : String(error)}`, 'error');
    toggleButton?.removeAttribute('disabled');
  }
}

async function setDryRun(enabled: boolean) {
  try {
    await invoke<ServiceStatus>('set_dry_run', { enabled });
  } catch (error: unknown) {
    showToast(`Failed to set dry run: ${error instanceof Error ? error.message : String(error)}`, 'error');
    if (dryRunToggle && currentStatus) dryRunToggle.checked = currentStatus.dryRun;
  }
}

async function setLaunchOnLogin(enabled: boolean) {
  try {
    await invoke<boolean>('set_launch_on_login', { enabled });
  } catch (error: unknown) {
    showToast(`Failed to update launch on login: ${error instanceof Error ? error.message : String(error)}`, 'error');
    if (launchToggle && currentStatus) launchToggle.checked = currentStatus.launchOnLogin;
  }
}

async function undoLast() {
  undoButton?.setAttribute('disabled', 'true');
  try {
    const result = await invoke<{ ok: boolean; reason?: string }>('undo');
    if (result.ok) {
      showToast('Undo applied', 'info');
    } else {
      showToast(result.reason ?? 'Undo failed', 'warn');
    }
  } catch (error: unknown) {
    showToast(`Undo failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    undoButton?.removeAttribute('disabled');
  }
}

async function addDirectory(directory: string) {
  const trimmed = directory.trim();
  if (!trimmed) {
    showToast('Enter a directory path first', 'warn');
    return;
  }
  addDirectoryInput?.setAttribute('disabled', 'true');
  try {
    await invoke('add_watch_dir', { directory: trimmed });
    showToast(`Added ${trimmed}`, 'info');
    if (addDirectoryInput) addDirectoryInput.value = '';
  } catch (error: unknown) {
    showToast(`Failed to add directory: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    addDirectoryInput?.removeAttribute('disabled');
  }
}

function wireUI() {
  toggleButton?.addEventListener('click', toggleRunning);
  dryRunToggle?.addEventListener('change', (event) => {
    const target = event.currentTarget as HTMLInputElement;
    setDryRun(target.checked);
  });
  launchToggle?.addEventListener('change', (event) => {
    const target = event.currentTarget as HTMLInputElement;
    setLaunchOnLogin(target.checked);
  });
  undoButton?.addEventListener('click', undoLast);
  refreshButton?.addEventListener('click', refreshStatus);
  addDirectoryForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (addDirectoryInput) {
      addDirectory(addDirectoryInput.value);
    }
  });
}

async function bootstrap() {
  wireUI();

  await listen<ServiceStatus>('service://status', (event) => {
    renderStatus(event.payload);
    toggleButton?.removeAttribute('disabled');
  });

  await listen<ToastPayload>('service://toast', (event) => {
    const payload = event.payload;
    showToast(payload.message, payload.level);
  });

  refreshStatus().catch((error) => {
    console.error('Failed to load initial status', error);
    showToast('Unable to load initial status', 'error');
    if (statusSummary) statusSummary.textContent = 'Unable to connect to Namefix service';
  });
}

bootstrap().catch((error) => {
  console.error('Bootstrap failure', error);
  showToast('Fatal error starting UI', 'error');
});
