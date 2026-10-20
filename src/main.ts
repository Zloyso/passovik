import { Notice, Plugin } from 'obsidian';
import { disposeClipboard } from './clipboard';
import { setLanguage, t } from './i18n';
import { isValidFolder, movedFolder, vaultFolderOf } from './location';
import type { VaultData } from './model';
import { DEFAULT_SETTINGS, type PassovikSettings, parseSettings } from './settings';
import { KeyChangedError, VaultStore } from './store';
import { GeneratorModal } from './ui/modals';
import { PassovikSettingTab } from './ui/settings-tab';
import { PassovikView, VIEW_TYPE } from './ui/view';

export default class PassovikPlugin extends Plugin {
	settings: PassovikSettings = DEFAULT_SETTINGS;
	store!: VaultStore;
	/** Folder the user picked by hand in this session; a vault found elsewhere must not override it. */
	chosenFolder: string | null = null;
	private lastActivity = Date.now();
	private locating: Promise<string[]> | null = null;

	async onload(): Promise<void> {
		this.settings = parseSettings(await this.loadData());
		setLanguage(this.settings.language);
		this.store = new VaultStore(this.app, () => this.settings);

		this.registerView(VIEW_TYPE, (leaf) => new PassovikView(leaf, this));
		this.addRibbonIcon('key', t('openVault'), () => void this.openVault());

		this.addCommand({ id: 'open', name: t('commandOpen'), callback: () => void this.openVault() });
		this.addCommand({
			id: 'lock',
			name: t('commandLock'),
			checkCallback: (checking) => {
				if (!this.store.isUnlocked) {
					return false;
				}
				if (!checking) {
					this.lock();
				}
				return true;
			},
		});
		this.addCommand({
			id: 'generate-password',
			name: t('commandGenerate'),
			callback: () => new GeneratorModal(this, null).open(),
		});

		this.addSettingTab(new PassovikSettingTab(this.app, this));

		this.registerInterval(window.setInterval(() => this.checkAutoLock(), 10_000));
		this.registerDomEvent(document, 'visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				if (this.settings.lockOnHide && this.store.isUnlocked) {
					this.lock();
				}
			} else {
				// Timers may be paused in the background on mobile; check right away.
				this.checkAutoLock();
			}
		});

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on('modify', (file) => void this.onFileChanged(file.path)));
			this.registerEvent(this.app.vault.on('create', (file) => void this.onFileChanged(file.path)));
			this.registerEvent(this.app.vault.on('delete', (file) => void this.onFileChanged(file.path)));
			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void this.onFileRenamed(file.path, oldPath)));
		});
	}

	onunload(): void {
		this.store?.lock();
		disposeClipboard();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	noteActivity(): void {
		this.lastActivity = Date.now();
	}

	lock(): void {
		this.store.lock();
		this.refreshViews();
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof PassovikView) {
				leaf.view.refresh();
			}
		}
	}

	async setVaultFolder(folder: string): Promise<void> {
		this.settings.folder = folder;
		await this.saveSettings();
	}

	/**
	 * Looks for the vault elsewhere when its file is missing: the folder was moved here or on another device.
	 * Switches to it when exactly one is found; otherwise returns the candidates for the user to choose.
	 */
	locateVault(): Promise<string[]> {
		this.locating ??= this.findMovedVault().finally(() => {
			this.locating = null;
		});
		return this.locating;
	}

	private async findMovedVault(): Promise<string[]> {
		if (await this.store.exists()) {
			return [];
		}
		const found = await this.store.findVaultFolders();
		if (found.length !== 1 || this.settings.folder === this.chosenFolder) {
			return found;
		}
		const [folder] = found;
		await this.setVaultFolder(folder);
		new Notice(t('vaultFound', { folder }));
		return [];
	}

	async openVault(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	/** Applies a change to the vault and saves it. Returns false (and reports) on failure. */
	async updateVault(change: (data: VaultData) => void): Promise<boolean> {
		this.noteActivity();
		try {
			if (!(await this.store.exists())) {
				// Don't recreate the file at the old path if the folder was just moved elsewhere.
				await this.locateVault();
			}
			await this.store.update(change);
			return true;
		} catch (err) {
			this.handleStoreError(err);
			return false;
		} finally {
			this.refreshViews();
		}
	}

	private handleStoreError(err: unknown): void {
		if (err instanceof KeyChangedError) {
			this.lock();
			new Notice(t('keyChangedElsewhere'), 10_000);
			return;
		}
		console.error('Passovik: vault operation failed', err);
		new Notice(t('saveFailed'));
	}

	private checkAutoLock(): void {
		const minutes = this.settings.autoLockMinutes;
		if (minutes > 0 && this.store.isUnlocked && Date.now() - this.lastActivity >= minutes * 60_000) {
			this.lock();
			new Notice(t('autoLocked'));
		}
	}

	private async onFileRenamed(path: string, oldPath: string): Promise<void> {
		const folder = movedFolder(this.store.folder, oldPath, path);
		if (folder !== null && isValidFolder(folder)) {
			await this.setVaultFolder(folder);
			new Notice(t('vaultMoved', { folder }));
		}
		if (folder !== null && !this.store.isUnlocked) {
			this.refreshViews();
		}
	}

	private async onFileChanged(path: string): Promise<void> {
		if (path !== this.store.path) {
			// A vault file appeared elsewhere while ours is missing: the folder may have been moved on another device.
			if (vaultFolderOf(path) === null || (await this.store.exists())) {
				return;
			}
		}
		await this.locateVault();
		if (!this.store.isUnlocked) {
			this.refreshViews();
			return;
		}
		try {
			if (await this.store.reloadFromDisk()) {
				this.refreshViews();
			}
		} catch (err) {
			this.handleStoreError(err);
		}
	}
}
