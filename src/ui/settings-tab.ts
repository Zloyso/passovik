import { type App, normalizePath, Notice, PluginSettingTab, Setting } from 'obsidian';
import { type Language, setLanguage, t } from '../i18n';
import { isValidFolder } from '../location';
import type PassovikPlugin from '../main';
import { ChangePasswordModal } from './modals';

export class PassovikSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: PassovikPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		new Setting(containerEl)
			.setName(t('settingLanguage'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('ru', 'Русский')
					.addOption('en', 'English')
					.addOption('auto', t('languageAuto'))
					.setValue(settings.language)
					.onChange(async (value) => {
						settings.language = value as Language;
						setLanguage(settings.language);
						await save();
						this.plugin.refreshViews();
						this.display();
					}),
			);

		// Security
		new Setting(containerEl).setName(t('sectionSecurity')).setHeading();

		new Setting(containerEl)
			.setName(t('settingAutoLock'))
			.setDesc(t('settingAutoLockDesc'))
			.addDropdown((dropdown) => {
				for (const minutes of [0, 1, 5, 15, 30, 60, 240]) {
					dropdown.addOption(String(minutes), minutes ? t('minutes', { count: minutes }) : t('never'));
				}
				dropdown.setValue(String(settings.autoLockMinutes)).onChange(async (value) => {
					settings.autoLockMinutes = Number(value);
					this.plugin.noteActivity();
					await save();
				});
			});

		new Setting(containerEl)
			.setName(t('settingLockOnHide'))
			.setDesc(t('settingLockOnHideDesc'))
			.addToggle((toggle) =>
				toggle.setValue(settings.lockOnHide).onChange(async (value) => {
					settings.lockOnHide = value;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName(t('settingClipboard'))
			.setDesc(t('settingClipboardDesc'))
			.addDropdown((dropdown) => {
				for (const seconds of [0, 15, 30, 60, 120]) {
					dropdown.addOption(String(seconds), seconds ? t('seconds', { count: seconds }) : t('never'));
				}
				dropdown.setValue(String(settings.clipboardClearSeconds)).onChange(async (value) => {
					settings.clipboardClearSeconds = Number(value);
					await save();
				});
			});

		new Setting(containerEl)
			.setName(t('changePassword'))
			.setDesc(this.plugin.store.isUnlocked ? t('settingChangePasswordDesc') : t('unlockFirst'))
			.addButton((button) =>
				button
					.setButtonText(t('changePasswordAction'))
					.setDisabled(!this.plugin.store.isUnlocked)
					.onClick(() => new ChangePasswordModal(this.plugin).open()),
			);

		// Storage
		new Setting(containerEl).setName(t('sectionStorage')).setHeading();

		let folderValue = settings.folder;
		new Setting(containerEl)
			.setName(t('settingFolder'))
			.setDesc(t('settingFolderDesc'))
			.addText((text) =>
				text
					.setPlaceholder('Passovik')
					.setValue(settings.folder)
					.onChange((value) => {
						folderValue = value;
					}),
			)
			.addButton((button) =>
				button.setButtonText(t('apply')).onClick(async () => {
					const folder = normalizePath(folderValue.trim());
					if (!isValidFolder(folder)) {
						new Notice(t('folderInvalid'));
						return;
					}
					if (folder === settings.folder) {
						return;
					}
					this.plugin.lock();
					this.plugin.chosenFolder = folder;
					await this.plugin.setVaultFolder(folder);
					this.plugin.refreshViews();
					new Notice(t('folderChanged', { folder }));
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName(t('settingBackupInterval'))
			.setDesc(t('settingBackupIntervalDesc'))
			.addDropdown((dropdown) => {
				for (const minutes of [15, 60, 360, 1440]) {
					dropdown.addOption(String(minutes), minutes < 60 ? t('minutes', { count: minutes }) : t('hours', { count: minutes / 60 }));
				}
				dropdown.setValue(String(settings.backupIntervalMinutes)).onChange(async (value) => {
					settings.backupIntervalMinutes = Number(value);
					await save();
				});
			});

		new Setting(containerEl)
			.setName(t('settingBackupKeep'))
			.setDesc(t('settingBackupKeepDesc'))
			.addDropdown((dropdown) => {
				for (const count of [0, 5, 10, 20, 50]) {
					dropdown.addOption(String(count), count ? String(count) : t('backupsOff'));
				}
				dropdown.setValue(String(settings.backupKeep)).onChange(async (value) => {
					settings.backupKeep = Number(value);
					await save();
				});
			});

		new Setting(containerEl)
			.setName(t('settingTrash'))
			.setDesc(t('settingTrashDesc'))
			.addDropdown((dropdown) => {
				for (const days of [7, 30, 90, 365, 0]) {
					dropdown.addOption(String(days), days ? t('days', { count: days }) : t('forever'));
				}
				dropdown.setValue(String(settings.trashDays)).onChange(async (value) => {
					settings.trashDays = Number(value);
					await save();
				});
			});
	}
}
