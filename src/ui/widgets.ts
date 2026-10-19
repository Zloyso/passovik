import { setIcon, setTooltip } from 'obsidian';
import type { StrengthScore } from '../generator';
import { t } from '../i18n';

/** Turns off autocorrect/capitalization on mobile keyboards and spellcheck everywhere. */
export function secretInputAttrs(input: HTMLInputElement | HTMLTextAreaElement): void {
	input.setAttrs({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
}

export function iconButton(
	parent: HTMLElement,
	icon: string,
	label: string,
	onClick: (event: MouseEvent) => void,
	cls = '',
): HTMLButtonElement {
	const button = parent.createEl('button', {
		cls: `clickable-icon passovik-icon-button ${cls}`.trim(),
		attr: { 'aria-label': label, type: 'button' },
	});
	setIcon(button, icon);
	setTooltip(button, label);
	button.addEventListener('click', (event) => {
		event.stopPropagation();
		onClick(event);
	});
	return button;
}

const STRENGTH_LABELS = ['strength0', 'strength1', 'strength2', 'strength3', 'strength4'] as const;

export function renderStrengthMeter(parent: HTMLElement, score: StrengthScore): void {
	const meter = parent.createDiv({ cls: `passovik-strength is-score-${score}` });
	const bar = meter.createDiv({ cls: 'passovik-strength-bar' });
	for (let i = 0; i < 4; i++) {
		bar.createDiv({ cls: 'passovik-strength-segment' });
	}
	meter.createDiv({ cls: 'passovik-strength-label', text: t(STRENGTH_LABELS[score]) });
}
