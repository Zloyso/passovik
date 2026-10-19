import { type App, FuzzySuggestModal, Modal, Notice, Setting, type TFile } from 'obsidian';
import { copyText } from '../clipboard';
import { estimateStrength, generatePassword, MAX_LENGTH, MIN_LENGTH } from '../generator';
import { t } from '../i18n';
import type PassovikPlugin from '../main';
import { WrongPasswordError } from '../store';
import { renderStrengthMeter, secretInputAttrs } from './widgets';

/** Yes/no question. Resolves to true only when confirmed. */
export function confirmAction(
	app: App,
	options: { title: string; message: string; confirmText: string; danger?: boolean },
): Promise<boolean> {
	return new Promise((resolve) => {
		let decided = false;
		const modal = new (class extends Modal {
			onOpen() {
				this.setTitle(options.title);
				this.contentEl.createEl('p', { text: options.message, cls: 'passovik-modal-message' });
				new Setting(this.contentEl)
					.addButton((button) =>
						button.setButtonText(t('cancel')).onClick(() => this.close()),
					)
					.addButton((button) => {
						button.setButtonText(options.confirmText).onClick(() => {
							decided = true;
							this.close();
						});
						if (options.danger) {
							button.setWarning();
						} else {
							button.setCta();
						}
					});
			}
			onClose() {
				this.contentEl.empty();
				resolve(decided);
			}
		})(app);
		modal.open();
	});
}

/** Single-line text input. Resolves to the trimmed value or null when cancelled. */
export function promptText(app: App, options: { title: string; value?: string; placeholder?: string }): Promise<string | null> {
	return new Promise((resolve) => {
		let result: string | null = null;
		const modal = new (class extends Modal {
			onOpen() {
				this.setTitle(options.title);
				const form = this.contentEl.createEl('form', { cls: 'passovik-form' });
				const input = form.createEl('input', {
					type: 'text',
					value: options.value ?? '',
					attr: { placeholder: options.placeholder ?? '' },
				});
				const actions = form.createDiv({ cls: 'passovik-form-actions' });
				actions.createEl('button', { text: t('cancel'), type: 'button' }).addEventListener('click', () => this.close());
				actions.createEl('button', { text: t('save'), type: 'submit', cls: 'mod-cta' });
				form.addEventListener('submit', (event) => {
					event.preventDefault();
					const value = input.value.trim();
					if (value) {
						result = value;
						this.close();
					}
				});
				window.setTimeout(() => input.select(), 0);
			}
			onClose() {
				this.contentEl.empty();
				resolve(result);
			}
		})(app);
		modal.open();
	});
}

export class GeneratorModal extends Modal {
	private output!: HTMLInputElement;
	private meterHost!: HTMLElement;

	constructor(
		private readonly plugin: PassovikPlugin,
		private readonly onUse: ((password: string) => void) | null,
	) {
		super(plugin.app);
	}

	onOpen() {
		this.setTitle(t('generatorTitle'));
		this.modalEl.addClass('passovik-generator');
		const options = this.plugin.settings.generator;

		const outputRow = this.contentEl.createDiv({ cls: 'passovik-generator-output' });
		this.output = outputRow.createEl('input', { type: 'text', cls: 'passovik-mono', attr: { readonly: 'true' } });
		secretInputAttrs(this.output);
		this.meterHost = this.contentEl.createDiv();

		new Setting(this.contentEl).setName(t('generatorLength')).addSlider((slider) =>
			slider
				.setLimits(MIN_LENGTH, MAX_LENGTH, 1)
				.setValue(options.length)
				.setDynamicTooltip()
				.onChange((value) => {
					options.length = value;
					this.regenerate();
				}),
		);
		const toggle = (name: string, key: 'lowercase' | 'uppercase' | 'digits' | 'symbols' | 'avoidAmbiguous') =>
			new Setting(this.contentEl).setName(name).addToggle((control) =>
				control.setValue(options[key]).onChange((value) => {
					options[key] = value;
					this.regenerate();
				}),
			);
		toggle(t('generatorLowercase'), 'lowercase');
		toggle(t('generatorUppercase'), 'uppercase');
		toggle(t('generatorDigits'), 'digits');
		toggle(t('generatorSymbols'), 'symbols');
		toggle(t('generatorAvoidAmbiguous'), 'avoidAmbiguous');

		const buttons = new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(t('generatorRegenerate')).onClick(() => this.regenerate()))
			.addButton((button) =>
				button.setButtonText(t('copy')).onClick(async () => {
					await copyText(this.output.value, this.plugin.settings.clipboardClearSeconds);
					new Notice(t('copiedPassword'));
				}),
			);
		if (this.onUse) {
			const onUse = this.onUse;
			buttons.addButton((button) =>
				button
					.setButtonText(t('generatorUse'))
					.setCta()
					.onClick(() => {
						onUse(this.output.value);
						this.close();
					}),
			);
		}
		this.regenerate();
	}

	private regenerate() {
		this.output.value = generatePassword(this.plugin.settings.generator);
		this.meterHost.empty();
		renderStrengthMeter(this.meterHost, estimateStrength(this.output.value).score);
	}

	onClose() {
		void this.plugin.saveSettings();
		this.contentEl.empty();
	}
}

export class ChangePasswordModal extends Modal {
	constructor(private readonly plugin: PassovikPlugin) {
		super(plugin.app);
	}

	onOpen() {
		this.setTitle(t('changePasswordTitle'));
		const form = this.contentEl.createEl('form', { cls: 'passovik-form' });
		const field = (label: string, autocomplete: string) => {
			form.createEl('label', { text: label, cls: 'passovik-label' });
			const input = form.createEl('input', { type: 'password', attr: { autocomplete } });
			secretInputAttrs(input);
			return input;
		};
		const current = field(t('currentPassword'), 'current-password');
		const next = field(t('newPassword'), 'new-password');
		const meterHost = form.createDiv();
		const confirm = field(t('confirmPassword'), 'new-password');
		next.addEventListener('input', () => {
			meterHost.empty();
			if (next.value) {
				renderStrengthMeter(meterHost, estimateStrength(next.value).score);
			}
		});
		form.createEl('p', { text: t('changePasswordBackupsNote'), cls: 'passovik-muted' });
		const error = form.createDiv({ cls: 'passovik-error' });
		const actions = form.createDiv({ cls: 'passovik-form-actions' });
		actions.createEl('button', { text: t('cancel'), type: 'button' }).addEventListener('click', () => this.close());
		const submit = actions.createEl('button', { text: t('changePasswordAction'), type: 'submit', cls: 'mod-cta' });

		form.addEventListener('submit', (event) => {
			event.preventDefault();
			error.setText('');
			if (next.value.length < 8) {
				error.setText(t('passwordTooShort'));
				return;
			}
			if (next.value !== confirm.value) {
				error.setText(t('passwordsDoNotMatch'));
				return;
			}
			submit.disabled = true;
			submit.setText(t('working'));
			this.plugin.store
				.changePassword(current.value, next.value)
				.then(() => {
					new Notice(t('passwordChanged'));
					this.close();
				})
				.catch((err: unknown) => {
					error.setText(err instanceof WrongPasswordError ? t('wrongPassword') : t('saveFailed'));
					submit.disabled = false;
					submit.setText(t('changePasswordAction'));
				});
		});
		window.setTimeout(() => current.focus(), 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class CsvFilePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder(t('importPickFile'));
		this.emptyStateText = t('importNoCsv');
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((file) => file.extension.toLowerCase() === 'csv');
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}
