import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const statusButton = document.querySelector<HTMLButtonElement>('#show-status');
const statusOutput = document.querySelector<HTMLPreElement>('#status');

type ServiceStatus = {
  running: boolean;
  directories: string[];
  dryRun: boolean;
};

async function subscribeToStatus() {
  if (!statusOutput) return;
  await listen<ServiceStatus>('service://status', (event) => {
    statusOutput.textContent = JSON.stringify(event.payload, null, 2);
  });
}

statusButton?.addEventListener('click', async () => {
  if (!statusOutput) return;
  statusOutput.textContent = 'Loading status...';
  try {
    const status = await invoke<ServiceStatus>('get_status');
    statusOutput.textContent = JSON.stringify(status, null, 2);
  } catch (error: unknown) {
    statusOutput.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
});

subscribeToStatus().catch((error) => {
  console.error('Failed to subscribe to status events', error);
});

// bootstrap on load
if (statusOutput) {
  invoke<ServiceStatus>('get_status')
    .then((status) => {
      statusOutput.textContent = JSON.stringify(status, null, 2);
    })
    .catch(() => {
      statusOutput.textContent = 'Status unavailable';
    });
}
