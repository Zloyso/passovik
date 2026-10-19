import { Notice, Plugin } from 'obsidian';
import { disposeClipboard } from './clipboard';
import { setLanguage, t } from './i18n';
import type { VaultData } from './model';
import { DEFAULT_SETTINGS, type PassovikSettings, parseSettings } from './settings';
import { KeyChangedError, VaultStore } from './store';
import { GeneratorModal } from './ui/modals';
import { PassovikSettingTab } from './ui/settings-tab';
import { PassovikView, VIEW_TYPE } from './ui/view';

export default class PassovikPlugin extends Plugin {
	settings: PassovikSettings = DEFAULT_SETTINGS;
	store!: VaultStore;
	private lastActivity = Date.now();

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
			this.registerEvent(this.app.vault.on('modify', (file) => this.onFileChanged(file.path)));
			this.registerEvent(this.app.vault.on('create', (file) => this.onFileChanged(file.path)));
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

	async openVault(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	openSettings(): void {
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	/** Applies a change to the vault and saves it. Returns false (and reports) on failure. */
	async updateVault(change: (data: VaultData) => void): Promise<boolean> {
		this.noteActivity();
		try {
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

	private onFileChanged(path: string): void {
		if (path !== this.store.path) {
			return;
		}
		if (!this.store.isUnlocked) {
			this.refreshViews();
			return;
		}
		this.store
			.reloadFromDisk()
			.then((changed) => {
				if (changed) {
					this.refreshViews();
				}
			})
			.catch((err: unknown) => this.handleStoreError(err));
	}
}
