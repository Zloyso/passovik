// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { menus, notices, openModals, Platform, TFile } from './obsidian-stub';
import { setLanguage } from '../src/i18n';
import type { VaultData } from '../src/model';
import { parseSettings } from '../src/settings';
import { VaultStore } from '../src/store';
import { PassovikView } from '../src/ui/view';

// ---------- Test environment ----------

let resizeCallback: (() => void) | null = null;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
	constructor(cb: () => void) {
		resizeCallback = cb;
	}
	observe() {}
	disconnect() {}
};

let clipboard = '';
Object.defineProperty(navigator, 'clipboard', {
	value: { writeText: async (text: string) => void (clipboard = text), readText: async () => clipboard },
});
const opened: string[] = [];
window.open = ((url: string) => {
	opened.push(url);
	return null;
}) as typeof window.open;

class MemoryAdapter {
	files = new Map<string, { text: string; mtime: number }>();
	dirs = new Set<string>();
	async exists(path: string) {
		return this.files.has(path) || this.dirs.has(path);
	}
	async read(path: string) {
		const file = this.files.get(path);
		if (!file) throw new Error(`ENOENT ${path}`);
		return file.text;
	}
	async write(path: string, text: string) {
		this.files.set(path, { text, mtime: Date.now() });
	}
	async mkdir(path: string) {
		this.dirs.add(path);
	}
	async list(path: string) {
		const files = [...this.files.keys()].filter((f) => f.slice(0, f.lastIndexOf('/')) === path);
		return { files, folders: [] };
	}
	async remove(path: string) {
		this.files.delete(path);
	}
	async stat(path: string) {
		const file = this.files.get(path);
		return file ? { mtime: file.mtime } : null;
	}
}

const adapter = new MemoryAdapter();
const app = {
	vault: {
		adapter,
		getFiles: () => [...adapter.files.keys()].map((p) => new TFile(p, p.split('.').pop() ?? '')),
		read: async (file: TFile) => adapter.read(file.path),
		create: async (path: string, text: string) => adapter.write(path, text),
	},
	fileManager: { trashFile: async (file: TFile) => adapter.remove(file.path) },
};

const settings = parseSettings({});
const store = new VaultStore(app as never, () => settings);
let view: PassovikView;
const plugin = {
	app,
	settings,
	store,
	noteActivity() {},
	saveSettings: async () => {},
	openSettings() {},
	lock() {
		store.lock();
		view.refresh();
	},
	refreshViews() {
		view.refresh();
	},
	async updateVault(change: (data: VaultData) => void) {
		try {
			await store.update(change);
			return true;
		} catch (err) {
			console.error(err);
			return false;
		} finally {
			view.refresh();
		}
	},
};

// ---------- Helpers ----------

const root = () => view.contentEl;
const q = <T extends Element = HTMLElement>(sel: string) => root().querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string) => [...root().querySelectorAll<T>(sel)];
const byLabel = (label: string) => {
	const el = q<HTMLElement>(`[aria-label="${label}"]`);
	if (!el) throw new Error(`No element labelled "${label}"`);
	return el;
};
const typeInto = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = (form: HTMLFormElement) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const text = () => root().textContent ?? '';

async function waitFor<T>(check: () => T, what: string, timeout = 20_000): Promise<NonNullable<T>> {
	const start = Date.now();
	for (;;) {
		const result = check();
		if (result) return result as NonNullable<T>;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 10));
	}
}

const topModal = () => openModals[openModals.length - 1];
function clickModalButton(label: string) {
	const modal = topModal();
	const button = [...(modal?.contentEl.querySelectorAll('button') ?? [])].find((b) => b.textContent === label);
	if (!button) throw new Error(`No modal button "${label}"`);
	button.click();
}
async function chooseMenu(title: string) {
	const items = menus[menus.length - 1];
	const item = items?.find((i) => i.title === title);
	if (!item) throw new Error(`No menu item "${title}"`);
	item.click();
}

const PASSWORD = 'correct horse 1';

// ---------- Scenario ----------

describe('Passovik view', () => {
	beforeAll(async () => {
		setLanguage('en');
		document.body.classList.remove('is-mobile');
		view = new PassovikView({ app } as never, plugin as never);
		await view.onOpen();
	});

	it('creates a vault with validation', async () => {
		const inputs = await waitFor(() => (qa('input[type="password"]').length === 2 ? qa<HTMLInputElement>('input') : null), 'create form');
		const form = q<HTMLFormElement>('form')!;

		typeInto(inputs[0]!, 'short');
		typeInto(inputs[1]!, 'short');
		submit(form);
		expect(text()).toContain('at least 8 characters');

		typeInto(inputs[0]!, PASSWORD);
		typeInto(inputs[1]!, 'different 123');
		submit(form);
		expect(text()).toContain('do not match');

		typeInto(inputs[1]!, PASSWORD);
		submit(form);
		await waitFor(() => q('.passovik-manager'), 'manager after create');
		expect(adapter.files.has('Passovik/vault.json')).toBe(true);
	});

	it('adds an entry and stores it encrypted', async () => {
		byLabel('New entry').click();
		const form = await waitFor(() => q<HTMLFormElement>('.passovik-editor'), 'editor');
		const [title, username] = [...form.querySelectorAll<HTMLInputElement>('input[type="text"]')];
		typeInto(title!, 'Bank');
		typeInto(username!, 'ivan');
		typeInto(form.querySelector<HTMLInputElement>('.passovik-input-row input')!, 'S3cret-Pa55!');
		typeInto(form.querySelector<HTMLInputElement>('input[type="url"]')!, 'bank.example.com');
		typeInto(form.querySelector('textarea')!, 'PIN in safe');
		submit(form);

		await waitFor(() => q('.passovik-detail-title')?.textContent === 'Bank', 'saved entry details');
		expect(notices).toContain('Saved');
		expect(qa('.passovik-entry-title').map((e) => e.textContent)).toEqual(['Bank']);

		const disk = adapter.files.get('Passovik/vault.json')!.text;
		expect(disk).not.toContain('Bank');
		expect(disk).not.toContain('S3cret');
	});

	it('copies the password and opens only safe links', async () => {
		q<HTMLElement>('.passovik-entry-copy')!.click();
		await waitFor(() => clipboard === 'S3cret-Pa55!', 'clipboard');
		byLabel('Open link').click();
		expect(opened).toEqual(['https://bank.example.com/']);
	});

	it('creates a group via the prompt', async () => {
		byLabel('New group').click();
		const modal = topModal()!;
		const input = modal.contentEl.querySelector('input')!;
		input.value = 'Work';
		submit(modal.contentEl.querySelector('form')!);
		await waitFor(() => qa('.passovik-nav-label').some((e) => e.textContent === 'Work'), 'group in nav');
		expect(store.data.groups.map((g) => g.name)).toEqual(['Work']);
	});

	it('filters by search', async () => {
		[...qa('.passovik-nav-item')].find((e) => e.textContent?.includes('All entries'))!.click();
		await waitFor(() => qa('.passovik-entry').length === 1, 'all entries');
		const search = q<HTMLInputElement>('.passovik-search input')!;
		typeInto(search, 'zzz');
		expect(text()).toContain('Nothing found');
		typeInto(search, 'ivan');
		expect(qa('.passovik-entry')).toHaveLength(1);
		typeInto(search, '');
	});

	it('moves to trash and restores', async () => {
		qa<HTMLElement>('.passovik-entry')[0]!.click();
		byLabel('Move to trash').click();
		await waitFor(() => notices.includes('Entry moved to the trash'), 'trash notice');
		expect(qa('.passovik-entry')).toHaveLength(0);

		[...qa('.passovik-nav-item')].find((e) => e.textContent?.includes('Trash'))!.click();
		await waitFor(() => qa('.passovik-entry').length === 1, 'entry in trash');
		qa<HTMLElement>('.passovik-entry')[0]!.click();
		byLabel('Restore').click();
		await waitFor(() => notices.includes('Entry restored'), 'restore notice');
		expect(store.data.entries[0]?.deletedAt).toBeNull();
	});

	it('locks, rejects a wrong password and unlocks', async () => {
		byLabel('Lock').click();
		const input = await waitFor(() => (qa('input[type="password"]').length === 1 ? q<HTMLInputElement>('input') : null), 'unlock form');
		expect(store.isUnlocked).toBe(false);
		expect(text()).not.toContain('Bank');

		typeInto(input, 'wrong password');
		submit(q<HTMLFormElement>('form')!);
		await waitFor(() => text().includes('Wrong password'), 'wrong password error');

		typeInto(input, PASSWORD);
		submit(q<HTMLFormElement>('form')!);
		await waitFor(() => q('.passovik-manager'), 'manager after unlock');
		expect(qa('.passovik-entry-title').map((e) => e.textContent)).toEqual(['Bank']);
	});

	it('uses a single pane with back navigation on phones', async () => {
		Platform.isPhone = true;
		resizeCallback?.();
		await waitFor(() => q('.passovik-manager.is-narrow'), 'narrow layout');
		expect(qa('.passovik-pane')).toHaveLength(1);
		expect(q('.passovik-pane-list')).not.toBeNull();

		qa<HTMLElement>('.passovik-entry')[0]!.click();
		await waitFor(() => q('.passovik-pane-detail'), 'detail pane');
		expect(qa('.passovik-pane')).toHaveLength(1);
		expect(byLabel('Back').classList.contains('is-hidden')).toBe(false);

		byLabel('Back').click();
		await waitFor(() => q('.passovik-pane-list'), 'back to list');
		byLabel('Back').click();
		await waitFor(() => q('.passovik-pane-groups'), 'back to groups');
		expect(byLabel('Back').classList.contains('is-hidden')).toBe(true);

		// jsdom has no layout; give the view a desktop width.
		Object.defineProperty(view.contentEl, 'clientWidth', { value: 1200, configurable: true });
		Platform.isPhone = false;
		resizeCallback?.();
		await waitFor(() => qa('.passovik-pane').length === 3, 'wide layout again');
	});

	it('imports a CSV file and offers to delete it', async () => {
		await adapter.write(
			'import.csv',
			'Название,Имя пользователя,Пароль,Ссылка,Заметки,Группа\nПочта,ivan@mail.ru,mail-pass,mail.ru,,Личное\nVPN,me,vpn-pass,,,Work\n',
		);
		byLabel('More').click();
		await chooseMenu('Import from CSV');
		const picker = topModal() as unknown as { onChooseItem: (f: TFile) => void };
		picker.onChooseItem(new TFile('import.csv', 'csv'));

		await waitFor(() => topModal()?.title === 'Import from CSV', 'import confirm');
		clickModalButton('Import');
		await waitFor(() => notices.includes('Imported: 2'), 'import notice');
		await waitFor(() => topModal()?.title === 'Delete the source file?', 'delete prompt');
		clickModalButton('Delete');
		await waitFor(() => !adapter.files.has('import.csv'), 'csv removed');

		expect(store.data.entries).toHaveLength(3);
		expect(store.data.groups.map((g) => g.name).sort()).toEqual(['Work', 'Личное']);
	});

	it('exports a CSV after confirmation', async () => {
		byLabel('More').click();
		await chooseMenu('Export to CSV');
		await waitFor(() => topModal()?.title === 'Export to CSV', 'export confirm');
		clickModalButton('Export');
		const exported = await waitFor(
			() => [...adapter.files.keys()].find((p) => p.startsWith('passovik-export-')),
			'export file',
		);
		const csv = adapter.files.get(exported)!.text;
		expect(csv.split('\r\n')[0]).toBe('title,username,password,url,notes,group');
		expect(csv).toContain('vpn-pass');
	});

	it('merges changes made on another device', async () => {
		const other = new VaultStore(app as never, () => settings);
		await other.unlock(PASSWORD);
		await other.update((data) => {
			data.entries.push({
				id: 'remote-1',
				title: 'From phone',
				username: '',
				password: 'x',
				urls: [],
				notes: '',
				groupId: null,
				favorite: false,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				deletedAt: null,
			});
		});
		expect(await store.reloadFromDisk()).toBe(true);
		view.refresh();
		await waitFor(() => qa('.passovik-entry-title').some((e) => e.textContent === 'From phone'), 'remote entry');

		// A local save afterwards must keep both sides.
		[...qa('.passovik-entry')].find((e) => e.textContent?.includes('VPN'))!.click();
		byLabel('Add to favorites').click();
		await waitFor(() => store.data.entries.find((e) => e.title === 'VPN')?.favorite, 'favorite saved');
		const check = new VaultStore(app as never, () => settings);
		await check.unlock(PASSWORD);
		expect(check.data.entries.map((e) => e.title).sort()).toEqual(['Bank', 'From phone', 'VPN', 'Почта']);
	});
});
