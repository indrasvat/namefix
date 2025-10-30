import { invoke } from '@tauri-apps/api/core';

const statusButton = document.querySelector<HTMLButtonElement>('#show-status');
const statusOutput = document.querySelector<HTMLPreElement>('#status');

type ServiceStatus = {
  running: boolean;
  directories: string[];
  dryRun: boolean;
};

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
