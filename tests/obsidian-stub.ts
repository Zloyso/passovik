/**
 * Minimal stand-in for the Obsidian API so UI code can run under jsdom in tests.
 * Only what Passovik uses is implemented.
 */

type DomInfo = { cls?: string; text?: string; type?: string; value?: string; attr?: Record<string, string> };

// ---------- HTMLElement helpers that Obsidian adds to the DOM ----------

function applyInfo(el: HTMLElement, info?: DomInfo | string): void {
	if (typeof info === 'string') {
		el.className = info;
		return;
	}
	if (!info) return;
	if (info.cls) el.className = info.cls;
	if (info.text !== undefined) el.textContent = info.text;
	// Like Obsidian: `type` from DomElementInfo is applied to <input> only, not to <button>.
	if (info.type && el instanceof HTMLInputElement) el.type = info.type;
	if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
	for (const [k, v] of Object.entries(info.attr ?? {})) el.setAttribute(k, v);
}

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.createEl = function (this: HTMLElement, tag: string, info?: DomInfo | string) {
	const el = document.createElement(tag);
	applyInfo(el, info);
	this.appendChild(el);
	return el;
};
proto.createDiv = function (this: HTMLElement, info?: DomInfo | string) {
	return (this as unknown as { createEl: (t: string, i?: unknown) => HTMLElement }).createEl('div', info);
};
proto.createSpan = function (this: HTMLElement, info?: DomInfo | string) {
	return (this as unknown as { createEl: (t: string, i?: unknown) => HTMLElement }).createEl('span', info);
};
proto.empty = function (this: HTMLElement) {
	while (this.firstChild) this.removeChild(this.firstChild);
};
proto.setText = function (this: HTMLElement, text: string) {
	this.textContent = text;
};
proto.appendText = function (this: HTMLElement, text: string) {
	this.appendChild(document.createTextNode(text));
};
proto.addClass = function (this: HTMLElement, ...cls: string[]) {
	this.classList.add(...cls);
};
proto.toggleClass = function (this: HTMLElement, cls: string, value: boolean) {
	this.classList.toggle(cls, value);
};
proto.setAttrs = function (this: HTMLElement, attrs: Record<string, string>) {
	for (const [k, v] of Object.entries(attrs)) this.setAttribute(k, v);
};
proto.setAttr = function (this: HTMLElement, k: string, v: string) {
	this.setAttribute(k, v);
};
proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
	for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
};

// ---------- API ----------

export const Platform = { isDesktopApp: true, isMobile: false, isPhone: false, isIosApp: false, isAndroidApp: false };

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export function getLanguage(): string {
	return 'en';
}

export function setIcon(el: HTMLElement, icon: string): void {
	el.setAttribute('data-icon', icon);
}

export function setTooltip(): void {}

export const notices: string[] = [];
export class Notice {
	constructor(message: string) {
		notices.push(message);
	}
}

export const openModals: Modal[] = [];
export class Modal {
	contentEl = document.createElement('div');
	modalEl = document.createElement('div');
	title = '';
	constructor(public app: unknown) {}
	setTitle(title: string) {
		this.title = title;
		return this;
	}
	open() {
		openModals.push(this);
		(this as unknown as { onOpen?: () => void }).onOpen?.();
	}
	close() {
		const i = openModals.indexOf(this);
		if (i >= 0) openModals.splice(i, 1);
		(this as unknown as { onClose?: () => void }).onClose?.();
	}
}

export class FuzzySuggestModal<T> extends Modal {
	emptyStateText = '';
	setPlaceholder() {}
	getItems(): T[] {
		return [];
	}
}

class ButtonComponent {
	buttonEl: HTMLButtonElement;
	constructor(parent: HTMLElement) {
		this.buttonEl = parent.ownerDocument.createElement('button');
		parent.appendChild(this.buttonEl);
	}
	setButtonText(text: string) {
		this.buttonEl.textContent = text;
		return this;
	}
	onClick(fn: () => void) {
		this.buttonEl.addEventListener('click', fn);
		return this;
	}
	setCta() {
		return this;
	}
	setWarning() {
		return this;
	}
	setDisabled(disabled: boolean) {
		this.buttonEl.disabled = disabled;
		return this;
	}
}

class ValueComponent<V> {
	private handler: ((value: V) => unknown) | null = null;
	value!: V;
	setValue(value: V) {
		this.value = value;
		return this;
	}
	onChange(fn: (value: V) => unknown) {
		this.handler = fn;
		return this;
	}
	trigger(value: V) {
		this.value = value;
		return this.handler?.(value);
	}
	setLimits() {
		return this;
	}
	setDynamicTooltip() {
		return this;
	}
	setPlaceholder() {
		return this;
	}
	addOption() {
		return this;
	}
}

export class Setting {
	settingEl: HTMLElement;
	components: unknown[] = [];
	constructor(container: HTMLElement) {
		this.settingEl = container.ownerDocument.createElement('div');
		container.appendChild(this.settingEl);
	}
	setName(name: string) {
		this.settingEl.setAttribute('data-name', name);
		return this;
	}
	setDesc() {
		return this;
	}
	setHeading() {
		return this;
	}
	addButton(cb: (b: ButtonComponent) => void) {
		const b = new ButtonComponent(this.settingEl);
		cb(b);
		this.components.push(b);
		return this;
	}
	private addValue(cb: (c: ValueComponent<never>) => void) {
		const c = new ValueComponent<never>();
		cb(c);
		this.components.push(c);
		return this;
	}
	addToggle(cb: (c: ValueComponent<never>) => void) {
		return this.addValue(cb);
	}
	addSlider(cb: (c: ValueComponent<never>) => void) {
		return this.addValue(cb);
	}
	addDropdown(cb: (c: ValueComponent<never>) => void) {
		return this.addValue(cb);
	}
	addText(cb: (c: ValueComponent<never>) => void) {
		return this.addValue(cb);
	}
	addExtraButton() {
		return this;
	}
}

export interface MenuItemStub {
	title: string;
	click: () => void;
}
export const menus: MenuItemStub[][] = [];
export class Menu {
	items: MenuItemStub[] = [];
	addItem(cb: (item: unknown) => void) {
		const entry: MenuItemStub = { title: '', click: () => undefined };
		const item = {
			setTitle(title: string) {
				entry.title = title;
				return item;
			},
			setIcon() {
				return item;
			},
			setWarning() {
				return item;
			},
			onClick(fn: () => void) {
				entry.click = fn;
				return item;
			},
		};
		cb(item);
		this.items.push(entry);
		return this;
	}
	addSeparator() {
		return this;
	}
	showAtMouseEvent() {
		menus.push(this.items);
	}
}

export class ItemView {
	app: unknown;
	contentEl = document.createElement('div');
	constructor(public leaf: { app: unknown }) {
		this.app = leaf.app;
	}
	registerDomEvent(el: HTMLElement, type: string, cb: EventListener) {
		el.addEventListener(type, cb);
	}
}

export class PluginSettingTab {
	containerEl = document.createElement('div');
	constructor(
		public app: unknown,
		public plugin: unknown,
	) {}
}

export class Plugin {}

export class TFile {
	constructor(
		public path: string,
		public extension: string,
	) {}
	get name() {
		return this.path.split('/').pop() ?? '';
	}
}
