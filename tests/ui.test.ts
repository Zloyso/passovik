// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { menus, notices, openModals, Platform, TFile, TFolder } from './obsidian-stub';
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

/** In-memory Vault API on top of the adapter's file map. */
const toFile = (path: string) => {
	const file = new TFile(path, path.split('.').pop() ?? '');
	file.stat.mtime = adapter.files.get(path)?.mtime ?? 0;
	return file;
};
const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const vault = {
	adapter,
	getFiles: () => [...adapter.files.keys()].map(toFile),
	getFileByPath: (path: string) => (adapter.files.has(path) ? toFile(path) : null),
	getFolderByPath: (path: string) => {
		if (!adapter.dirs.has(path)) return null;
		const children = [...adapter.files.keys()].filter((f) => folderOf(f) === path).map(toFile);
		return new TFolder(path, children);
	},
	getAbstractFileByPath: (path: string) =>
		adapter.files.has(path) ? toFile(path) : adapter.dirs.has(path) ? new TFolder(path) : null,
	read: async (file: TFile) => adapter.read(file.path),
	modify: async (file: TFile, text: string) => {
		if (!adapter.files.has(file.path)) throw new Error(`modify: no file ${file.path}`);
		await adapter.write(file.path, text);
	},
	create: async (path: string, text: string) => {
		if (adapter.files.has(path)) throw new Error(`create: file exists ${path}`);
		if (folderOf(path) && !adapter.dirs.has(folderOf(path))) throw new Error(`create: no folder for ${path}`);
		await adapter.write(path, text);
		return toFile(path);
	},
	createFolder: async (path: string) => {
		if (adapter.dirs.has(path)) throw new Error(`createFolder: exists ${path}`);
		await adapter.mkdir(path);
	},
	delete: async (file: TFile) => adapter.remove(file.path),
};
const app = {
	vault,
	workspace: { layoutReady: true, onLayoutReady: (cb: () => void) => cb() },
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
// requestSubmit() runs constraint validation like a real click on the submit button.
const submit = (form: HTMLFormElement) => form.requestSubmit();
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

	it('does not save when adding a link or cancelling', async () => {
		const before = store.data.entries.length;
		byLabel('New entry').click();
		const form = await waitFor(() => q<HTMLFormElement>('.passovik-editor'), 'editor');
		typeInto(form.querySelector<HTMLInputElement>('input[type="text"]')!, 'Draft only');

		const addLink = [...form.querySelectorAll('button')].find((b) => b.textContent === '+ Add link')!;
		addLink.click();
		expect(form.querySelectorAll('input[type="url"]')).toHaveLength(2);

		[...form.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
		await waitFor(() => topModal()?.title === 'Discard changes?', 'discard prompt');
		clickModalButton('Discard');
		await waitFor(() => !q('.passovik-editor'), 'editor closed');
		expect(store.data.entries).toHaveLength(before);

		qa<HTMLElement>('.passovik-entry')[0]!.click();
		await waitFor(() => q('.passovik-detail-title')?.textContent === 'Bank', 'details back');
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

	it('creates, nests, moves and removes subgroups', async () => {
		const groupItem = (name: string) =>
			qa('.passovik-nav-item').find((e) => e.querySelector('.passovik-nav-label')?.textContent === name);
		const openMenuOf = (name: string) =>
			groupItem(name)!.querySelector<HTMLElement>('[aria-label="Group actions"]')!.click();
		const promptAnswer = (value: string) => {
			const modal = topModal()!;
			modal.contentEl.querySelector('input')!.value = value;
			submit(modal.contentEl.querySelector('form')!);
		};

		// Subgroup "Projects" inside "Work"
		openMenuOf('Work');
		await chooseMenu('New subgroup');
		expect(topModal()?.title).toBe('New subgroup in "Work"');
		promptAnswer('Projects');
		await waitFor(() => groupItem('Projects'), 'subgroup in nav');
		expect(groupItem('Projects')!.style.getPropertyValue('--passovik-depth')).toBe('1');

		// "/" is rejected, duplicates among siblings are rejected
		openMenuOf('Work');
		await chooseMenu('New subgroup');
		promptAnswer('a/b');
		await waitFor(() => notices.includes('Group names cannot contain "/"'), 'slash rejected');
		openMenuOf('Work');
		await chooseMenu('New subgroup');
		promptAnswer('projects');
		await waitFor(() => notices.includes('A group with this name already exists'), 'duplicate rejected');
		expect(store.data.groups.map((g) => g.name).sort()).toEqual(['Projects', 'Work']);

		// An entry in the subgroup is counted and listed in the parent too
		const projects = store.data.groups.find((g) => g.name === 'Projects')!;
		await plugin.updateVault((data) => {
			data.entries.push({ ...data.entries[0]!, id: 'nested-1', title: 'Jira', groupId: projects.id });
		});
		await waitFor(() => groupItem('Work')?.querySelector('.passovik-nav-count')?.textContent === '1', 'parent count');
		groupItem('Work')!.click();
		await waitFor(() => qa('.passovik-entry-title').some((e) => e.textContent === 'Jira'), 'nested entry in parent');
		qa<HTMLElement>('.passovik-entry').find((e) => e.textContent?.includes('Jira'))!.click();
		await waitFor(() => text().includes('Work / Projects'), 'group path in details');

		// Collapse hides the subgroup
		groupItem('Work')!.querySelector<HTMLElement>('[aria-label="Collapse"]')!.click();
		await waitFor(() => !groupItem('Projects'), 'collapsed');
		groupItem('Work')!.querySelector<HTMLElement>('[aria-label="Expand"]')!.click();
		await waitFor(() => groupItem('Projects'), 'expanded');

		// Cannot move "Work" into its own subgroup: it is not offered
		openMenuOf('Work');
		await chooseMenu('Move to…');
		const picker = topModal() as unknown as { getItems(): { id: string | null; label: string }[]; close(): void };
		expect(picker.getItems().map((o) => o.label)).not.toContain('Work / Projects');
		picker.close();

		// Move "Projects" to the top level
		openMenuOf('Projects');
		await chooseMenu('Move to…');
		const movePicker = topModal() as unknown as { onChooseItem(o: { id: string | null; label: string }): void };
		movePicker.onChooseItem({ id: null, label: 'Top level' });
		await waitFor(() => groupItem('Projects')?.style.getPropertyValue('--passovik-depth') === '0', 'moved to top');

		// Put it back and delete the parent: Projects and its entry move up
		const work = store.data.groups.find((g) => g.name === 'Work')!;
		await plugin.updateVault((data) => {
			data.groups.find((g) => g.id === projects.id)!.parentId = work.id;
		});
		openMenuOf('Work');
		await chooseMenu('Delete group');
		await waitFor(() => topModal()?.title === 'Delete group', 'delete confirm');
		clickModalButton('Delete');
		await waitFor(() => !groupItem('Work'), 'work removed');
		expect(store.data.groups.find((g) => g.id === projects.id)?.parentId).toBeNull();
		expect(store.data.entries.find((e) => e.id === 'nested-1')?.groupId).toBe(projects.id);

		// Recreate "Work" so later tests that use it keep working
		await plugin.updateVault((data) => {
			data.groups.push({ ...work, updatedAt: Date.now() });
			delete data.tombstones[work.id];
		});
		await plugin.updateVault((data) => {
			data.entries = data.entries.filter((e) => e.id !== 'nested-1');
			data.groups = data.groups.filter((g) => g.id !== projects.id);
		});
	});

	it('moves groups by drag and drop', async () => {
		const now = Date.now();
		await plugin.updateVault((data) => {
			data.groups.push(
				{ id: 'g-alpha', name: 'Alpha', parentId: null, createdAt: now, updatedAt: now },
				{ id: 'g-beta', name: 'Beta', parentId: null, createdAt: now, updatedAt: now },
				{ id: 'g-gamma', name: 'Gamma', parentId: 'g-alpha', createdAt: now, updatedAt: now },
			);
		});
		const item = (name: string) =>
			qa('.passovik-nav-item').find((e) => e.querySelector('.passovik-nav-label')?.textContent === name)!;
		const header = () => q<HTMLElement>('.passovik-nav-header')!;
		const drag = (type: string, target: HTMLElement) => {
			const event = new Event(type, { bubbles: true, cancelable: true });
			Object.defineProperty(event, 'dataTransfer', {
				value: { setData: () => undefined, effectAllowed: '', dropEffect: '' },
			});
			Object.defineProperty(event, 'relatedTarget', { value: null });
			target.dispatchEvent(event);
			return event;
		};
		const parentOf = (id: string) => store.data.groups.find((g) => g.id === id)?.parentId;
		await waitFor(() => item('Gamma'), 'groups rendered');
		expect(item('Beta').getAttribute('draggable')).toBe('true');

		// Beta onto Alpha: allowed, highlighted, becomes a subgroup
		drag('dragstart', item('Beta'));
		expect(item('Beta').classList.contains('is-dragging')).toBe(true);
		const over = drag('dragover', item('Alpha'));
		expect(over.defaultPrevented).toBe(true);
		expect(item('Alpha').classList.contains('is-drop-target')).toBe(true);
		drag('drop', item('Alpha'));
		await waitFor(() => parentOf('g-beta') === 'g-alpha', 'Beta moved into Alpha');

		// Alpha onto its own subgroup Gamma: refused
		drag('dragstart', item('Alpha'));
		expect(drag('dragover', item('Gamma')).defaultPrevented).toBe(false);
		expect(item('Gamma').classList.contains('is-drop-target')).toBe(false);
		drag('drop', item('Gamma'));
		drag('dragend', item('Alpha'));
		expect(parentOf('g-alpha')).toBeNull();

		// Gamma onto the "Groups" header: moves to the top level
		drag('dragstart', item('Gamma'));
		expect(drag('dragover', header()).defaultPrevented).toBe(true);
		drag('drop', header());
		await waitFor(() => parentOf('g-gamma') === null, 'Gamma moved to top level');

		// A top-level group is not offered the header again (already there)
		drag('dragstart', item('Gamma'));
		expect(drag('dragover', header()).defaultPrevented).toBe(false);
		drag('dragend', item('Gamma'));

		await plugin.updateVault((data) => {
			data.groups = data.groups.filter((g) => !['g-alpha', 'g-beta', 'g-gamma'].includes(g.id));
		});
	});

	it('moves entries into groups by drag and drop and by the Move button', async () => {
		const now = Date.now();
		await plugin.updateVault((data) => {
			data.groups.push(
				{ id: 'g-home', name: 'Home', parentId: null, createdAt: now, updatedAt: now },
				{ id: 'g-office', name: 'Office', parentId: null, createdAt: now, updatedAt: now },
			);
			data.entries.push({ ...data.entries[0]!, id: 'e-card', title: 'Card', groupId: null, deletedAt: null, updatedAt: now });
		});
		const navItem = (name: string) =>
			qa('.passovik-nav-item').find((e) => e.querySelector('.passovik-nav-label')?.textContent === name)!;
		const row = (title: string) =>
			qa('.passovik-entry').find((e) => e.querySelector('.passovik-entry-title')?.textContent === title)!;
		const drag = (type: string, target: HTMLElement) => {
			const event = new Event(type, { bubbles: true, cancelable: true });
			Object.defineProperty(event, 'dataTransfer', { value: { setData: () => undefined, effectAllowed: '', dropEffect: '' } });
			Object.defineProperty(event, 'relatedTarget', { value: null });
			target.dispatchEvent(event);
			return event;
		};
		const groupOf = () => store.data.entries.find((e) => e.id === 'e-card')?.groupId;

		[...qa('.passovik-nav-item')].find((e) => e.textContent?.includes('All entries'))!.click();
		await waitFor(() => row('Card'), 'card listed');
		expect(row('Card').getAttribute('draggable')).toBe('true');

		// Drag the card onto "Home"
		drag('dragstart', row('Card'));
		expect(drag('dragover', navItem('Home')).defaultPrevented).toBe(true);
		drag('drop', navItem('Home'));
		await waitFor(() => groupOf() === 'g-home', 'card in Home');
		await waitFor(() => notices.includes('Entry moved to Home'), 'move notice');

		// Its own group does not accept it again
		drag('dragstart', row('Card'));
		expect(drag('dragover', navItem('Home')).defaultPrevented).toBe(false);
		drag('dragend', row('Card'));

		// Dropping on the "Groups" header takes it out of any group
		drag('dragstart', row('Card'));
		expect(drag('dragover', q<HTMLElement>('.passovik-nav-header')!).defaultPrevented).toBe(true);
		drag('drop', q<HTMLElement>('.passovik-nav-header')!);
		await waitFor(() => groupOf() === null, 'card without group');

		// "Move to group…" button in the details (the way it works on phones)
		row('Card').click();
		await waitFor(() => q('.passovik-detail-title')?.textContent === 'Card', 'card details');
		byLabel('Move to group…').click();
		const picker = topModal() as unknown as {
			getItems(): { id: string | null; label: string }[];
			onChooseItem(o: { id: string | null; label: string }): void;
		};
		const options = picker.getItems().map((o) => o.label);
		expect(options).toContain('Office');
		expect(options).not.toContain('No group'); // already without a group
		picker.onChooseItem({ id: 'g-office', label: 'Office' });
		await waitFor(() => groupOf() === 'g-office', 'card in Office via picker');

		// Entries in the trash are not draggable
		await plugin.updateVault((data) => {
			data.entries.find((e) => e.id === 'e-card')!.deletedAt = Date.now();
		});
		[...qa('.passovik-nav-item')].find((e) => e.textContent?.includes('Trash'))!.click();
		await waitFor(() => row('Card'), 'card in trash');
		expect(row('Card').getAttribute('draggable')).toBeNull();

		await plugin.updateVault((data) => {
			data.entries = data.entries.filter((e) => e.id !== 'e-card');
			data.groups = data.groups.filter((g) => !['g-home', 'g-office'].includes(g.id));
		});
		[...qa('.passovik-nav-item')].find((e) => e.textContent?.includes('All entries'))!.click();
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

	it('keeps every backup when writes happen within the same second', async () => {
		const backups = () => [...adapter.files.keys()].filter((p) => p.startsWith('Passovik/backups/'));
		const before = backups().length;
		await store.changePassword(PASSWORD, 'temporary pw 2');
		await store.changePassword('temporary pw 2', PASSWORD);
		expect(backups().length).toBe(before + 2);
		expect(new Set(backups()).size).toBe(backups().length);
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
