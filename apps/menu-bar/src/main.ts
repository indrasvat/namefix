const statusButton = document.querySelector<HTMLButtonElement>('#show-status');
const statusOutput = document.querySelector<HTMLPreElement>('#status');

statusButton?.addEventListener('click', async () => {
  const placeholder = {
    running: false,
    directories: [],
    dryRun: true
  };
  statusOutput!.textContent = JSON.stringify(placeholder, null, 2);
});
