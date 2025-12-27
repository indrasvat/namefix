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

type Profile = {
	id: string;
	name: string;
	enabled: boolean;
	pattern: string;
	isRegex?: boolean;
	template: string;
	prefix: string;
	priority: number;
};

const statusIndicator = document.querySelector<HTMLDivElement>('#status-indicator');
const statusIcon = document.querySelector<HTMLSpanElement>('#status-icon');
const statusTitle = document.querySelector<HTMLHeadingElement>('#status-title');
const statusSummary = document.querySelector<HTMLParagraphElement>('#status-summary');
const directoriesList = document.querySelector<HTMLUListElement>('#directories');
const toggleButton = document.querySelector<HTMLButtonElement>('#toggle-running');
const dryRunToggle = document.querySelector<HTMLInputElement>('#dry-run-toggle');
const launchToggle = document.querySelector<HTMLInputElement>('#launch-login-toggle');
const undoButton = document.querySelector<HTMLButtonElement>('#undo-button');
const addDirectoryForm = document.querySelector<HTMLFormElement>('#add-directory-form');
const addDirectoryInput = document.querySelector<HTMLInputElement>('#new-directory');
const toastContainer = document.querySelector<HTMLDivElement>('#toast');

// Badges
const badgeDirs = document.querySelector<HTMLSpanElement>('#badge-dirs');
const badgeDryRun = document.querySelector<HTMLSpanElement>('#badge-dry-run');
const badgeLogin = document.querySelector<HTMLSpanElement>('#badge-login');
const metricDirectories = document.querySelector<HTMLSpanElement>('#metric-directories');
const metricDryRun = document.querySelector<HTMLSpanElement>('#metric-dry-run');
const metricLaunch = document.querySelector<HTMLSpanElement>('#metric-launch');

const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab-target]'));
const tabViews = Array.from(document.querySelectorAll<HTMLElement>('[data-tab]'));

// Profile elements
const profilesList = document.querySelector<HTMLUListElement>('#profiles');
const addProfileBtn = document.querySelector<HTMLButtonElement>('#add-profile-btn');
const profileModal = document.querySelector<HTMLDivElement>('#profile-modal');
const profileForm = document.querySelector<HTMLFormElement>('#profile-form');
const profileIdInput = document.querySelector<HTMLInputElement>('#profile-id');
const profileNameInput = document.querySelector<HTMLInputElement>('#profile-name');
const profilePatternInput = document.querySelector<HTMLInputElement>('#profile-pattern');
const profileIsRegexInput = document.querySelector<HTMLInputElement>('#profile-is-regex');
const profileTemplateInput = document.querySelector<HTMLInputElement>('#profile-template');
const profilePrefixInput = document.querySelector<HTMLInputElement>('#profile-prefix');
const profilePriorityInput = document.querySelector<HTMLInputElement>('#profile-priority');
const deleteProfileBtn = document.querySelector<HTMLButtonElement>('#delete-profile-btn');
const modalTitle = document.querySelector<HTMLHeadingElement>('#modal-title');
const modalCloseBtn = document.querySelector<HTMLButtonElement>('.modal-close');
const modalCancelBtn = document.querySelector<HTMLButtonElement>('.modal-cancel');
const previewOriginal = document.querySelector<HTMLDivElement>('#preview-original');
const previewResult = document.querySelector<HTMLDivElement>('#preview-result');
const templateAutocomplete = document.querySelector<HTMLDivElement>('#template-autocomplete');

// Template variables for autocomplete
const TEMPLATE_VARIABLES = [
	{ name: '<date>', desc: '2024-12-26' },
	{ name: '<time>', desc: '21-30-00' },
	{ name: '<datetime>', desc: '2024-12-26_21-30-00' },
	{ name: '<original>', desc: 'Original filename' },
	{ name: '<ext>', desc: '.png (with dot)' },
	{ name: '<counter>', desc: '001, 002...' },
	{ name: '<prefix>', desc: 'Profile prefix' },
	{ name: '<year>', desc: '2024' },
	{ name: '<month>', desc: '12' },
	{ name: '<day>', desc: '26' },
	{ name: '<hour>', desc: '21' },
	{ name: '<minute>', desc: '30' },
	{ name: '<second>', desc: '00' },
];

let currentStatus: ServiceStatus | null = null;
let currentProfiles: Profile[] = [];
let toastTimeout: ReturnType<typeof setTimeout> | null = null;
let autocompleteIndex = -1;
let autocompleteFilter = '';

// --- Autocomplete Functions ---

function showAutocomplete(filter = '') {
	if (!templateAutocomplete || !profileTemplateInput) return;

	autocompleteFilter = filter.toLowerCase();
	const filtered = TEMPLATE_VARIABLES.filter(
		(v) =>
			v.name.toLowerCase().includes(autocompleteFilter) ||
			v.desc.toLowerCase().includes(autocompleteFilter),
	);

	if (filtered.length === 0) {
		hideAutocomplete();
		return;
	}

	clearElement(templateAutocomplete);
	autocompleteIndex = -1;

	for (const variable of filtered) {
		const item = document.createElement('div');
		item.className = 'autocomplete-item';
		item.dataset.value = variable.name;

		const varName = document.createElement('span');
		varName.className = 'var-name';
		varName.textContent = variable.name;

		const varDesc = document.createElement('span');
		varDesc.className = 'var-desc';
		varDesc.textContent = variable.desc;

		item.append(varName, varDesc);
		item.addEventListener('click', () => selectAutocompleteItem(variable.name));
		templateAutocomplete.appendChild(item);
	}

	templateAutocomplete.hidden = false;
}

function hideAutocomplete() {
	if (templateAutocomplete) {
		templateAutocomplete.hidden = true;
		autocompleteIndex = -1;
	}
}

function selectAutocompleteItem(value: string) {
	if (!profileTemplateInput) return;

	const input = profileTemplateInput;
	const cursorPos = input.selectionStart ?? input.value.length;
	const textBefore = input.value.slice(0, cursorPos);
	const textAfter = input.value.slice(cursorPos);

	// Find the position of the last '<' before cursor
	const lastOpenBracket = textBefore.lastIndexOf('<');
	if (lastOpenBracket !== -1) {
		// Replace from '<' to cursor with the selected variable
		input.value = textBefore.slice(0, lastOpenBracket) + value + textAfter;
		const newPos = lastOpenBracket + value.length;
		input.setSelectionRange(newPos, newPos);
	} else {
		// Just insert at cursor
		input.value = textBefore + value + textAfter;
		const newPos = cursorPos + value.length;
		input.setSelectionRange(newPos, newPos);
	}

	hideAutocomplete();
	input.focus();
	updatePreview();
}

function navigateAutocomplete(direction: 'up' | 'down') {
	if (!templateAutocomplete || templateAutocomplete.hidden) return;

	const items = templateAutocomplete.querySelectorAll('.autocomplete-item');
	if (items.length === 0) return;

	// Remove current selection
	items[autocompleteIndex]?.classList.remove('selected');

	if (direction === 'down') {
		autocompleteIndex = autocompleteIndex < items.length - 1 ? autocompleteIndex + 1 : 0;
	} else {
		autocompleteIndex = autocompleteIndex > 0 ? autocompleteIndex - 1 : items.length - 1;
	}

	// Add selection to new item
	const selected = items[autocompleteIndex] as HTMLElement;
	selected.classList.add('selected');
	selected.scrollIntoView({ block: 'nearest' });
}

function confirmAutocomplete(): boolean {
	if (!templateAutocomplete || templateAutocomplete.hidden) return false;

	const items = templateAutocomplete.querySelectorAll('.autocomplete-item');
	if (autocompleteIndex >= 0 && autocompleteIndex < items.length) {
		const selected = items[autocompleteIndex] as HTMLElement;
		const value = selected.dataset.value;
		if (value) {
			selectAutocompleteItem(value);
			return true;
		}
	}
	return false;
}

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
	const dry = status.dryRun ? ' · dry run' : '';
	if (!dirCount) {
		return status.running
			? `No directories configured${dry}`
			: `Add a directory to get started${dry}`;
	}
	return status.running
		? `Monitoring ${dirCount} ${dirLabel}${dry}`
		: `${dirCount} ${dirLabel} configured${dry}`;
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

function clearElement(element: Element) {
	while (element.firstChild) {
		element.removeChild(element.firstChild);
	}
}

function renderDirectories(status: ServiceStatus) {
	if (!directoriesList) return;
	clearElement(directoriesList);

	if (!status.directories.length) {
		const empty = document.createElement('li');
		empty.className = 'directory-item';
		empty.textContent = 'No directories configured yet';
		empty.style.color = 'var(--text-subtle)';
		empty.style.justifyContent = 'center';
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
				showToast(`Removed ${baseName}`, 'info');
			} catch (error: unknown) {
				showToast(
					`Failed to remove: ${error instanceof Error ? error.message : String(error)}`,
					'error',
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

	// Update hero section
	if (statusIndicator) {
		statusIndicator.dataset.state = status.running ? 'active' : 'paused';
	}
	if (statusIcon) {
		statusIcon.textContent = status.running ? '👁' : '⏸';
	}
	if (statusTitle) {
		statusTitle.textContent = status.running ? 'Watching' : 'Paused';
	}
	if (statusSummary) {
		statusSummary.textContent = formatSummary(status);
	}

	// Update toggle button
	if (toggleButton) {
		toggleButton.textContent = status.running ? 'Pause Watching' : 'Start Watching';
	}

	// Update switches
	if (dryRunToggle) dryRunToggle.checked = status.dryRun;
	if (launchToggle) launchToggle.checked = status.launchOnLogin;

	// Update badges
	if (metricDirectories) {
		metricDirectories.textContent = String(status.directories.length);
	}
	if (badgeDirs) {
		badgeDirs.dataset.state = status.directories.length ? 'active' : 'muted';
	}

	if (metricDryRun) {
		metricDryRun.textContent = status.dryRun ? 'on' : 'off';
	}
	if (badgeDryRun) {
		badgeDryRun.dataset.state = status.dryRun ? 'warn' : 'muted';
	}

	if (metricLaunch) {
		metricLaunch.textContent = status.launchOnLogin ? 'on' : 'off';
	}
	if (badgeLogin) {
		badgeLogin.dataset.state = status.launchOnLogin ? 'active' : 'muted';
	}

	renderDirectories(status);
}

async function refreshStatus() {
	try {
		const status = await invoke<ServiceStatus>('get_status');
		renderStatus(status);
	} catch (error: unknown) {
		showToast(
			`Connection error: ${error instanceof Error ? error.message : String(error)}`,
			'error',
		);
	}
}

async function toggleRunning() {
	if (!currentStatus) return;
	toggleButton?.setAttribute('disabled', 'true');
	try {
		await invoke<ServiceStatus>('toggle_running', { desired: !currentStatus.running });
	} catch (error: unknown) {
		showToast(
			`Failed to toggle: ${error instanceof Error ? error.message : String(error)}`,
			'error',
		);
		toggleButton?.removeAttribute('disabled');
	}
}

async function setDryRun(enabled: boolean) {
	try {
		await invoke<ServiceStatus>('set_dry_run', { enabled });
	} catch (error: unknown) {
		showToast(
			`Failed to update: ${error instanceof Error ? error.message : String(error)}`,
			'error',
		);
		if (dryRunToggle && currentStatus) dryRunToggle.checked = currentStatus.dryRun;
	}
}

async function setLaunchOnLogin(enabled: boolean) {
	try {
		await invoke<boolean>('set_launch_on_login', { enabled });
	} catch (error: unknown) {
		showToast(
			`Failed to update: ${error instanceof Error ? error.message : String(error)}`,
			'error',
		);
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
			showToast(result.reason ?? 'Nothing to undo', 'warn');
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
		showToast('Enter a directory path', 'warn');
		return;
	}
	addDirectoryInput?.setAttribute('disabled', 'true');
	try {
		await invoke('add_watch_dir', { directory: trimmed });
		const segments = trimmed
			.replace(/[/\\]+$/, '')
			.split(/[/\\]/)
			.filter(Boolean);
		const baseName = segments.length ? segments[segments.length - 1] : trimmed;
		showToast(`Added ${baseName}`, 'info');
		if (addDirectoryInput) addDirectoryInput.value = '';
	} catch (error: unknown) {
		showToast(`Failed to add: ${error instanceof Error ? error.message : String(error)}`, 'error');
	} finally {
		addDirectoryInput?.removeAttribute('disabled');
	}
}

// --- Profile Management ---

function generateId(): string {
	return `profile-${crypto.randomUUID()}`;
}

function renderProfiles(profiles: Profile[]) {
	currentProfiles = profiles;
	if (!profilesList) return;
	clearElement(profilesList);

	if (!profiles.length) {
		const empty = document.createElement('li');
		empty.className = 'profile-item';
		empty.textContent = 'No profiles configured yet';
		empty.style.color = 'var(--text-subtle)';
		empty.style.justifyContent = 'center';
		profilesList.appendChild(empty);
		return;
	}

	for (const profile of profiles) {
		const item = document.createElement('li');
		item.className = 'profile-item';
		item.dataset.enabled = String(profile.enabled);

		const checkbox = document.createElement('div');
		checkbox.className = 'profile-checkbox';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = profile.enabled;
		input.addEventListener('change', () => toggleProfileEnabled(profile.id, input.checked));
		checkbox.appendChild(input);

		const info = document.createElement('div');
		info.className = 'profile-info';

		const name = document.createElement('span');
		name.className = 'profile-name';
		name.textContent = profile.name;

		const rule = document.createElement('span');
		rule.className = 'profile-rule';
		const patternText = profile.isRegex ? `/${profile.pattern}/` : profile.pattern;
		rule.innerHTML = `${patternText}<span class="arrow">→</span>${profile.template}`;

		info.append(name, rule);

		const actions = document.createElement('div');
		actions.className = 'profile-actions';

		const editBtn = document.createElement('button');
		editBtn.type = 'button';
		editBtn.className = 'button-ghost';
		editBtn.textContent = 'Edit';
		editBtn.addEventListener('click', () => openProfileModal(profile));

		actions.appendChild(editBtn);
		item.append(checkbox, info, actions);
		profilesList.appendChild(item);
	}
}

function openProfileModal(profile?: Profile) {
	if (!profileModal) return;

	const isNew = !profile;
	if (modalTitle) modalTitle.textContent = isNew ? 'Add Profile' : 'Edit Profile';
	if (deleteProfileBtn) deleteProfileBtn.hidden = isNew;

	if (profileIdInput) profileIdInput.value = profile?.id ?? '';
	if (profileNameInput) profileNameInput.value = profile?.name ?? '';
	if (profilePatternInput) profilePatternInput.value = profile?.pattern ?? '';
	if (profileIsRegexInput) profileIsRegexInput.checked = profile?.isRegex ?? false;
	if (profileTemplateInput) profileTemplateInput.value = profile?.template ?? '<prefix>_<datetime>';
	if (profilePrefixInput) profilePrefixInput.value = profile?.prefix ?? '';
	if (profilePriorityInput) profilePriorityInput.value = String(profile?.priority ?? 1);

	updatePreview();
	profileModal.hidden = false;
}

function closeProfileModal() {
	if (profileModal) profileModal.hidden = true;
}

function updatePreview() {
	const prefix = profilePrefixInput?.value ?? '';
	const template = profileTemplateInput?.value || '<prefix>_<datetime>';

	// Simple preview with sample values
	const sampleOriginal = 'Screenshot 2024-12-26 at 21.30.00.png';
	let result = template
		.replace(/<prefix>/g, prefix.replace(/\s+/g, '_'))
		.replace(/<date>/g, '2024-12-26')
		.replace(/<time>/g, '21-30-00')
		.replace(/<datetime>/g, '2024-12-26_21-30-00')
		.replace(/<original>/g, 'Screenshot 2024-12-26 at 21.30.00')
		.replace(/<ext>/g, '.png')
		.replace(/<counter>/g, '001')
		.replace(/<year>/g, '2024')
		.replace(/<month>/g, '12')
		.replace(/<day>/g, '26')
		.replace(/<hour>/g, '21')
		.replace(/<minute>/g, '30')
		.replace(/<second>/g, '00');

	// Add extension if template doesn't use <ext>
	if (!template.includes('<ext>')) {
		result += '.png';
	}

	if (previewOriginal) previewOriginal.textContent = sampleOriginal;
	if (previewResult) previewResult.textContent = result;
}

async function saveProfile() {
	const id = profileIdInput?.value || generateId();
	const name = profileNameInput?.value.trim();
	const pattern = profilePatternInput?.value.trim();
	const isRegex = profileIsRegexInput?.checked ?? false;
	const template = profileTemplateInput?.value.trim();
	const prefix = profilePrefixInput?.value.trim();
	const priority = Number.parseInt(profilePriorityInput?.value ?? '1', 10);

	if (!name || !pattern || !template) {
		showToast('Please fill in all required fields', 'warn');
		return;
	}

	const profile: Profile = {
		id,
		name,
		enabled: true,
		pattern,
		isRegex: isRegex || undefined,
		template,
		prefix,
		priority: Number.isNaN(priority) ? 1 : priority,
	};

	// Preserve enabled state if editing
	const existing = currentProfiles.find((p) => p.id === id);
	if (existing) {
		profile.enabled = existing.enabled;
	}

	try {
		const profiles = await invoke<Profile[]>('set_profile', { profile });
		renderProfiles(profiles);
		closeProfileModal();
		showToast(`Profile "${name}" saved`, 'info');
	} catch (error: unknown) {
		showToast(`Failed to save: ${error instanceof Error ? error.message : String(error)}`, 'error');
	}
}

async function deleteCurrentProfile() {
	const id = profileIdInput?.value;
	if (!id) return;

	const profile = currentProfiles.find((p) => p.id === id);
	const name = profile?.name ?? 'Profile';

	try {
		const profiles = await invoke<Profile[]>('delete_profile', { id });
		renderProfiles(profiles);
		closeProfileModal();
		showToast(`Deleted "${name}"`, 'info');
	} catch (error: unknown) {
		showToast(
			`Failed to delete: ${error instanceof Error ? error.message : String(error)}`,
			'error',
		);
	}
}

async function toggleProfileEnabled(id: string, enabled: boolean) {
	try {
		const profiles = await invoke<Profile[]>('toggle_profile', { id, enabled });
		renderProfiles(profiles);
	} catch (error: unknown) {
		showToast(
			`Failed to toggle: ${error instanceof Error ? error.message : String(error)}`,
			'error',
		);
		refreshProfiles();
	}
}

async function refreshProfiles() {
	try {
		const profiles = await invoke<Profile[]>('get_profiles');
		renderProfiles(profiles);
	} catch (error: unknown) {
		showToast(
			`Failed to load profiles: ${error instanceof Error ? error.message : String(error)}`,
			'error',
		);
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
	addDirectoryForm?.addEventListener('submit', (event) => {
		event.preventDefault();
		if (addDirectoryInput) {
			addDirectory(addDirectoryInput.value);
		}
	});

	// Profile UI wiring
	addProfileBtn?.addEventListener('click', () => openProfileModal());
	modalCloseBtn?.addEventListener('click', closeProfileModal);
	modalCancelBtn?.addEventListener('click', closeProfileModal);
	deleteProfileBtn?.addEventListener('click', deleteCurrentProfile);

	profileForm?.addEventListener('submit', (event) => {
		event.preventDefault();
		saveProfile();
	});

	// Update preview when template or prefix changes
	profileTemplateInput?.addEventListener('input', (e) => {
		updatePreview();

		// Show autocomplete when user types '<'
		const input = e.target as HTMLInputElement;
		const cursorPos = input.selectionStart ?? input.value.length;
		const textBefore = input.value.slice(0, cursorPos);
		const lastOpenBracket = textBefore.lastIndexOf('<');
		const lastCloseBracket = textBefore.lastIndexOf('>');

		// Show autocomplete if we're inside an unclosed '<'
		if (lastOpenBracket !== -1 && lastOpenBracket > lastCloseBracket) {
			const filter = textBefore.slice(lastOpenBracket + 1);
			showAutocomplete(filter);
		} else {
			hideAutocomplete();
		}
	});

	profileTemplateInput?.addEventListener('keydown', (e) => {
		if (templateAutocomplete && !templateAutocomplete.hidden) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				navigateAutocomplete('down');
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				navigateAutocomplete('up');
			} else if (e.key === 'Enter' || e.key === 'Tab') {
				if (confirmAutocomplete()) {
					e.preventDefault();
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				hideAutocomplete();
			}
		}
	});

	profileTemplateInput?.addEventListener('blur', () => {
		// Delay hiding to allow click events on autocomplete items
		setTimeout(hideAutocomplete, 150);
	});

	profilePrefixInput?.addEventListener('input', updatePreview);

	// Close modal on backdrop click
	profileModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeProfileModal);
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

	// Listen for config changes to refresh profiles
	await listen('service://config', () => {
		refreshProfiles();
	});

	// Load initial data
	refreshStatus().catch((error) => {
		console.error('Failed to load initial status', error);
		showToast('Unable to connect', 'error');
		if (statusSummary) statusSummary.textContent = 'Unable to connect to service';
	});

	refreshProfiles().catch((error) => {
		console.error('Failed to load profiles', error);
	});
}

bootstrap().catch((error) => {
	console.error('Bootstrap failure', error);
	showToast('Fatal error starting UI', 'error');
});
