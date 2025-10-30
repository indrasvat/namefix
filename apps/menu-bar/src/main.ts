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

let currentStatus: ServiceStatus | null = null;
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function formatSummary(status: ServiceStatus): string {
  const dirCount = status.directories.length;
  const dirLabel = dirCount === 1 ? 'directory' : 'directories';
  if (!dirCount) {
    return status.running ? 'Watching (no directories configured)' : 'Paused — add a directory to begin';
  }
  return status.running
    ? `Watching ${dirCount} ${dirLabel}${status.dryRun ? ' (dry run)' : ''}`
    : `Paused — ${dirCount} ${dirLabel} configured${status.dryRun ? ' (dry run)' : ''}`;
}

function showToast(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  if (!toastContainer) return;
  toastContainer.textContent = message;
  toastContainer.dataset.level = level;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastContainer.textContent = '';
  }, 4000);
}

function renderDirectories(status: ServiceStatus) {
  if (!directoriesList) return;
  directoriesList.innerHTML = '';

  if (!status.directories.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No directories configured yet';
    directoriesList.appendChild(empty);
    return;
  }

  status.directories.forEach((directory) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = directory;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'secondary';
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

    item.append(label, removeButton);
    directoriesList.appendChild(item);
  });
}

function renderStatus(status: ServiceStatus) {
  currentStatus = status;
  if (statusSummary) statusSummary.textContent = formatSummary(status);
  if (statusOutput) statusOutput.textContent = JSON.stringify(status, null, 2);
  if (toggleButton) toggleButton.textContent = status.running ? 'Pause Watching' : 'Start Watching';
  if (dryRunToggle) dryRunToggle.checked = status.dryRun;
  if (launchToggle) launchToggle.checked = status.launchOnLogin;
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
