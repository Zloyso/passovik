import { ItemView, Menu, normalizePath, Notice, Platform, setIcon, type TFile, type WorkspaceLeaf } from 'obsidian';
import { copyText } from '../clipboard';
import { CSV_COLUMNS, csvToRecords, parseCsv, toCsv } from '../csv';
import { estimateStrength } from '../generator';
import { t } from '../i18n';
import type PassovikPlugin from '../main';
import {
	compareEntries,
	createEntry,
	createGroup,
	descendantIds,
	type Entry,
	type EntryFilter,
	ensureGroupPath,
	type Group,
	type GroupNode,
	groupPath,
	groupTree,
	matchesFilter,
	matchesQuery,
	moveGroup,
	removeEntryForever,
	removeGroup,
	resolveParents,
} from '../model';
import { WrongPasswordError } from '../store';
import { displayHost, toSafeUrl } from '../url';
import { VaultFormatError } from '../vault-file';
import { ChangePasswordModal, confirmAction, CsvFilePicker, GeneratorModal, GroupPicker, promptText } from './modals';
import { iconButton, renderStrengthMeter, secretInputAttrs } from './widgets';

export const VIEW_TYPE = 'passovik-vault';

const NARROW_WIDTH = 720;
const MIN_MASTER_PASSWORD = 8;

type Pane = 'groups' | 'list' | 'detail';

interface Draft {
	id: string | null;
	title: string;
	username: string;
	password: string;
	urls: string[];
	notes: string;
	groupId: string | null;
	favorite: boolean;
}

const sameFilter = (a: EntryFilter, b: EntryFilter) =>
	a.kind === b.kind && (a.kind !== 'group' || (b.kind === 'group' && a.id === b.id));

export class PassovikView extends ItemView {
	private filter: EntryFilter = { kind: 'all' };
	private selectedId: string | null = null;
	private query = '';
	private pane: Pane = 'list';
	private draft: Draft | null = null;
	private draftDirty = false;
	private revealPassword = false;
	private narrow = false;
	private renderToken = 0;
	private resizeObserver: ResizeObserver | null = null;
	private panesEl: HTMLElement | null = null;
	private backButton: HTMLElement | null = null;
	/** Groups whose subgroups are hidden in the sidebar (kept for the session only). */
	private readonly collapsed = new Set<string>();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: PassovikPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Passovik';
	}

	getIcon(): string {
		return 'key';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('passovik-view');
		this.narrow = this.computeNarrow();
		this.resizeObserver = new ResizeObserver(() => this.handleResize());
		this.resizeObserver.observe(this.contentEl);
		this.registerDomEvent(this.contentEl, 'pointerdown', () => this.plugin.noteActivity());
		this.registerDomEvent(this.contentEl, 'keydown', () => this.plugin.noteActivity());
		await this.render();
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.contentEl.empty();
	}

	/** Re-renders after a lock/unlock or a data change. */
	refresh(): void {
		void this.render();
	}

	// ---------- Layout ----------

	private computeNarrow(): boolean {
		const width = this.contentEl.clientWidth;
		return Platform.isPhone || (width > 0 ? width < NARROW_WIDTH : this.narrow);
	}

	private handleResize(): void {
		const narrow = this.computeNarrow();
		if (narrow !== this.narrow) {
			this.narrow = narrow;
			if (narrow && this.pane === 'groups' && this.selectedId) {
				this.pane = 'detail';
			}
			// Re-render outside the observer callback to avoid "ResizeObserver loop" warnings.
			window.setTimeout(() => void this.render(), 0);
		}
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		const store = this.plugin.store;
		if (!store.isUnlocked) {
			const exists = await store.exists().catch(() => false);
			if (token !== this.renderToken) {
				return;
			}
			this.resetSessionState();
			this.contentEl.empty();
			this.renderLockScreen(exists);
			return;
		}
		this.contentEl.empty();
		this.renderManager();
	}

	private resetSessionState(): void {
		this.filter = { kind: 'all' };
		this.selectedId = null;
		this.draft = null;
		this.draftDirty = false;
		this.revealPassword = false;
		this.query = '';
		this.pane = 'list';
		this.panesEl = null;
		this.backButton = null;
	}

	// ---------- Lock screen ----------

	private renderLockScreen(exists: boolean): void {
		const wrap = this.contentEl.createDiv({ cls: 'passovik-lock' });
		const card = wrap.createDiv({ cls: 'passovik-lock-card' });
		setIcon(card.createDiv({ cls: 'passovik-lock-icon' }), exists ? 'lock' : 'key');
		card.createEl('h2', { text: 'Passovik' });
		card.createEl('p', { cls: 'passovik-muted', text: exists ? t('unlockHint') : t('createHint') });

		const form = card.createEl('form', { cls: 'passovik-form' });
		const password = form.createEl('input', {
			type: 'password',
			attr: { placeholder: t('masterPassword'), autocomplete: exists ? 'current-password' : 'new-password' },
		});
		secretInputAttrs(password);

		let confirm: HTMLInputElement | null = null;
		if (!exists) {
			const meterHost = form.createDiv();
			password.addEventListener('input', () => {
				meterHost.empty();
				if (password.value) {
					renderStrengthMeter(meterHost, estimateStrength(password.value).score);
				}
			});
			confirm = form.createEl('input', {
				type: 'password',
				attr: { placeholder: t('confirmPassword'), autocomplete: 'new-password' },
			});
			secretInputAttrs(confirm);
			form.createEl('p', { cls: 'passovik-warning', text: t('createWarning') });
		}

		const error = form.createDiv({ cls: 'passovik-error' });
		const submitText = exists ? t('unlock') : t('createVault');
		const submit = form.createEl('button', { attr: { type: 'submit' }, cls: 'mod-cta', text: submitText });
		card.createEl('p', { cls: 'passovik-muted passovik-small', text: t('vaultLocation', { path: this.plugin.store.path }) });

		form.addEventListener('submit', (event) => {
			event.preventDefault();
			error.setText('');
			if (!exists) {
				if (password.value.length < MIN_MASTER_PASSWORD) {
					error.setText(t('passwordTooShort'));
					return;
				}
				if (password.value !== confirm?.value) {
					error.setText(t('passwordsDoNotMatch'));
					return;
				}
			} else if (!password.value) {
				return;
			}

			submit.disabled = true;
			submit.setText(t('working'));
			const action = exists ? this.plugin.store.unlock(password.value) : this.plugin.store.create(password.value);
			action
				.then(() => {
					password.value = '';
					if (confirm) {
						confirm.value = '';
					}
					this.plugin.noteActivity();
					this.plugin.refreshViews();
				})
				.catch((err: unknown) => {
					if (err instanceof WrongPasswordError) {
						error.setText(t('wrongPassword'));
					} else if (err instanceof VaultFormatError) {
						error.setText(t('vaultDamaged'));
					} else {
						console.error('Passovik: unlock failed', err);
						error.setText(t('unlockFailed'));
					}
					submit.disabled = false;
					submit.setText(submitText);
					password.select();
				});
		});

		if (!Platform.isMobile) {
			window.setTimeout(() => password.focus(), 0);
		}
	}

	// ---------- Manager ----------

	private renderManager(): void {
		const root = this.contentEl.createDiv({ cls: 'passovik-manager' });
		root.toggleClass('is-narrow', this.narrow);
		this.renderToolbar(root.createDiv({ cls: 'passovik-toolbar' }));
		this.panesEl = root.createDiv({ cls: 'passovik-panes' });
		this.renderPanes();
	}

	private renderToolbar(bar: HTMLElement): void {
		this.backButton = iconButton(bar, 'chevron-left', t('back'), () => void this.goBack(), 'passovik-back');

		const search = bar.createDiv({ cls: 'passovik-search' });
		setIcon(search.createSpan({ cls: 'passovik-search-icon' }), 'search');
		const input = search.createEl('input', {
			type: 'search',
			value: this.query,
			attr: { placeholder: t('searchPlaceholder'), 'aria-label': t('searchPlaceholder') },
		});
		secretInputAttrs(input);
		input.addEventListener('input', () => {
			this.query = input.value;
			if (this.narrow && this.pane === 'groups') {
				this.pane = 'list';
			}
			this.renderPanes();
		});
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && input.value) {
				event.stopPropagation();
				input.value = '';
				this.query = '';
				this.renderPanes();
			}
		});

		const actions = bar.createDiv({ cls: 'passovik-toolbar-actions' });
		iconButton(actions, 'plus', t('newEntry'), () => void this.startCreate());
		iconButton(actions, 'dices', t('generatorTitle'), () => new GeneratorModal(this.plugin, null).open());
		iconButton(actions, 'lock', t('lockNow'), () => this.plugin.lock());
		iconButton(actions, 'more-vertical', t('more'), (event) => this.openMoreMenu(event));
	}

	private openMoreMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t('importCsv'))
				.setIcon('download')
				.onClick(() => new CsvFilePicker(this.app, (file) => void this.importFromFile(file)).open()),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('exportCsv'))
				.setIcon('upload')
				.onClick(() => void this.exportCsv()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t('changePassword'))
				.setIcon('key')
				.onClick(() => new ChangePasswordModal(this.plugin).open()),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('openSettings'))
				.setIcon('settings')
				.onClick(() => this.plugin.openSettings()),
		);
		menu.showAtMouseEvent(event);
	}

	private renderPanes(): void {
		const panes = this.panesEl;
		if (!panes || !this.plugin.store.isUnlocked) {
			return;
		}
		panes.empty();
		this.backButton?.toggleClass('is-hidden', !(this.narrow && this.pane !== 'groups'));

		if (!this.narrow) {
			this.renderGroupsPane(panes.createDiv({ cls: 'passovik-pane passovik-pane-groups' }));
			this.renderListPane(panes.createDiv({ cls: 'passovik-pane passovik-pane-list' }));
			this.renderDetailPane(panes.createDiv({ cls: 'passovik-pane passovik-pane-detail' }));
			return;
		}
		const pane = panes.createDiv({ cls: `passovik-pane passovik-pane-${this.pane}` });
		if (this.pane === 'groups') {
			this.renderGroupsPane(pane);
		} else if (this.pane === 'list') {
			this.renderListPane(pane);
		} else {
			this.renderDetailPane(pane);
		}
	}

	private async goBack(): Promise<void> {
		if (this.pane === 'detail') {
			if (this.draft && !(await this.confirmDiscard())) {
				return;
			}
			this.draft = null;
			this.draftDirty = false;
			this.pane = 'list';
		} else if (this.pane === 'list') {
			this.pane = 'groups';
		}
		this.renderPanes();
	}

	// ---------- Groups ----------

	private renderGroupsPane(pane: HTMLElement): void {
		const data = this.plugin.store.data;
		const active = data.entries.filter((entry) => entry.deletedAt === null);
		const nav = pane.createDiv({ cls: 'passovik-nav' });

		this.renderNavItem(nav, { kind: 'all' }, 'list', t('allEntries'), active.length);
		this.renderNavItem(nav, { kind: 'favorites' }, 'star', t('favorites'), active.filter((e) => e.favorite).length);

		const header = nav.createDiv({ cls: 'passovik-nav-header' });
		header.createSpan({ text: t('groups') });
		iconButton(header, 'folder-plus', t('newGroup'), () => void this.createGroupInteractive(null));

		const nodes = groupTree(data.groups);
		if (!nodes.length) {
			nav.createDiv({ cls: 'passovik-nav-empty passovik-muted', text: t('noGroups') });
		}
		const parents = resolveParents(data.groups);
		const insideCollapsed = (id: string) => {
			for (let p = parents.get(id) ?? null; p; p = parents.get(p) ?? null) {
				if (this.collapsed.has(p)) {
					return true;
				}
			}
			return false;
		};
		for (const node of nodes) {
			if (insideCollapsed(node.group.id)) {
				continue;
			}
			const scope = descendantIds(data.groups, node.group.id);
			const count = active.filter((entry) => entry.groupId !== null && scope.has(entry.groupId)).length;
			this.renderNavItem(nav, { kind: 'group', id: node.group.id }, 'folder', node.group.name, count, node);
		}

		nav.createDiv({ cls: 'passovik-nav-spacer' });
		const trashCount = data.entries.length - active.length;
		this.renderNavItem(nav, { kind: 'trash' }, 'trash-2', t('trash'), trashCount);
	}

	private renderNavItem(
		parent: HTMLElement,
		filter: EntryFilter,
		icon: string,
		label: string,
		count: number,
		node?: GroupNode,
	): void {
		const group = node?.group;
		const item = parent.createDiv({ cls: 'passovik-nav-item', attr: { role: 'button', tabindex: '0' } });
		item.toggleClass('is-active', sameFilter(filter, this.filter));
		if (node) {
			item.addClass('is-group');
			item.setCssProps({ '--passovik-depth': String(node.depth) });
			if (node.hasChildren) {
				const isCollapsed = this.collapsed.has(node.group.id);
				iconButton(
					item,
					isCollapsed ? 'chevron-right' : 'chevron-down',
					isCollapsed ? t('expandGroup') : t('collapseGroup'),
					() => {
						if (isCollapsed) {
							this.collapsed.delete(node.group.id);
						} else {
							this.collapsed.add(node.group.id);
						}
						this.renderPanes();
					},
					'passovik-nav-toggle',
				);
			} else {
				item.createSpan({ cls: 'passovik-nav-toggle-spacer' });
			}
		}
		setIcon(item.createSpan({ cls: 'passovik-nav-icon' }), icon);
		item.createSpan({ cls: 'passovik-nav-label', text: label });
		item.createSpan({ cls: 'passovik-nav-count', text: String(count) });
		if (group) {
			iconButton(item, 'more-horizontal', t('groupActions'), (event) => this.openGroupMenu(event, group), 'passovik-nav-menu');
			item.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				this.openGroupMenu(event, group);
			});
		}
		const activate = () => void this.selectFilter(filter);
		item.addEventListener('click', activate);
		item.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				activate();
			}
		});
	}

	private async selectFilter(filter: EntryFilter): Promise<void> {
		if (!(await this.confirmDiscard())) {
			return;
		}
		this.draft = null;
		this.draftDirty = false;
		if (!sameFilter(filter, this.filter)) {
			this.selectedId = null;
		}
		this.filter = filter;
		if (this.narrow) {
			this.pane = 'list';
		}
		this.renderPanes();
	}

	private openGroupMenu(event: MouseEvent, group: Group): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t('newSubgroup'))
				.setIcon('folder-plus')
				.onClick(() => void this.createGroupInteractive(group.id)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('renameGroup'))
				.setIcon('pencil')
				.onClick(() => void this.renameGroupInteractive(group)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('moveGroup'))
				.setIcon('folder-input')
				.onClick(() => this.moveGroupInteractive(group)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('deleteGroup'))
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => void this.deleteGroupInteractive(group)),
		);
		menu.showAtMouseEvent(event);
	}

	/** Names must be unique among siblings and must not contain "/" (it separates levels in paths). */
	private validGroupName(name: string, parentId: string | null, exceptId?: string): boolean {
		if (name.includes('/')) {
			new Notice(t('groupNameSlash'));
			return false;
		}
		const groups = this.plugin.store.data.groups;
		const parents = resolveParents(groups);
		const lower = name.toLocaleLowerCase();
		const taken = groups.some(
			(g) => g.id !== exceptId && (parents.get(g.id) ?? null) === parentId && g.name.toLocaleLowerCase() === lower,
		);
		if (taken) {
			new Notice(t('groupExists'));
			return false;
		}
		return true;
	}

	private async createGroupInteractive(parentId: string | null): Promise<void> {
		const title = parentId ? t('newSubgroupIn', { name: this.groupName(parentId) }) : t('newGroup');
		const name = await promptText(this.app, { title, placeholder: t('groupName') });
		if (!name || !this.validGroupName(name, parentId)) {
			return;
		}
		const group = createGroup(name, parentId);
		if (await this.plugin.updateVault((data) => data.groups.push(group))) {
			if (parentId) {
				this.collapsed.delete(parentId);
			}
			await this.selectFilter({ kind: 'group', id: group.id });
		}
	}

	private moveGroupInteractive(group: Group): void {
		const groups = this.plugin.store.data.groups;
		const blocked = descendantIds(groups, group.id);
		const currentParent = resolveParents(groups).get(group.id) ?? null;
		const options = [
			{ id: null, label: t('topLevel') },
			...groupTree(groups)
				.filter((node) => !blocked.has(node.group.id))
				.map((node) => ({ id: node.group.id, label: groupPath(groups, node.group.id).join(' / ') })),
		].filter((option) => option.id !== currentParent);

		new GroupPicker(this.app, t('moveGroupPlaceholder', { name: group.name }), options, (target) => {
			if (!this.validGroupName(group.name, target, group.id)) {
				return;
			}
			void this.plugin
				.updateVault((data) => {
					moveGroup(data, group.id, target);
				})
				.then((ok) => {
					if (ok && target) {
						this.collapsed.delete(target);
						this.renderPanes();
					}
				});
		}).open();
	}

	private async renameGroupInteractive(group: Group): Promise<void> {
		const name = await promptText(this.app, { title: t('renameGroup'), value: group.name });
		if (!name || name === group.name) {
			return;
		}
		const parentId = resolveParents(this.plugin.store.data.groups).get(group.id) ?? null;
		if (!this.validGroupName(name, parentId, group.id)) {
			return;
		}
		await this.plugin.updateVault((data) => {
			const target = data.groups.find((g) => g.id === group.id);
			if (target) {
				target.name = name;
				target.updatedAt = Date.now();
			}
		});
	}

	private async deleteGroupInteractive(group: Group): Promise<void> {
		const parentId = resolveParents(this.plugin.store.data.groups).get(group.id) ?? null;
		const ok = await confirmAction(this.app, {
			title: t('deleteGroup'),
			message: parentId
				? t('deleteGroupMessageParent', { name: group.name, parent: this.groupName(parentId) })
				: t('deleteGroupMessage', { name: group.name }),
			confirmText: t('delete'),
			danger: true,
		});
		if (!ok) {
			return;
		}
		if (this.filter.kind === 'group' && this.filter.id === group.id) {
			this.filter = parentId ? { kind: 'group', id: parentId } : { kind: 'all' };
		}
		this.collapsed.delete(group.id);
		await this.plugin.updateVault((data) => removeGroup(data, group.id));
	}

	// ---------- Entry list ----------

	/** Full path of a group, e.g. "Работа / Проекты". */
	private groupName(id: string | null): string {
		return groupPath(this.plugin.store.data.groups, id).join(' / ');
	}

	private filterLabel(): string {
		switch (this.filter.kind) {
			case 'all':
				return t('allEntries');
			case 'favorites':
				return t('favorites');
			case 'trash':
				return t('trash');
			case 'group':
				return this.groupName(this.filter.id) || t('allEntries');
		}
	}

	private visibleEntries(): Entry[] {
		const data = this.plugin.store.data;
		const scope = this.filter.kind === 'group' ? descendantIds(data.groups, this.filter.id) : undefined;
		return data.entries
			.filter((entry) => matchesFilter(entry, this.filter, scope))
			.filter((entry) => matchesQuery(entry, this.query, this.groupName(entry.groupId)))
			.sort(compareEntries);
	}

	private renderListPane(pane: HTMLElement): void {
		const entries = this.visibleEntries();
		const header = pane.createDiv({ cls: 'passovik-list-header' });
		header.createDiv({ cls: 'passovik-list-title', text: this.filterLabel() });
		header.createDiv({ cls: 'passovik-list-count', text: String(entries.length) });
		if (this.filter.kind === 'trash' && entries.length && !this.query) {
			iconButton(header, 'trash-2', t('emptyTrash'), () => void this.emptyTrash(), 'mod-warning');
		}

		const list = pane.createDiv({ cls: 'passovik-list' });
		if (!entries.length) {
			const empty = list.createDiv({ cls: 'passovik-empty' });
			const message = this.query ? t('noResults') : this.filter.kind === 'trash' ? t('trashEmpty') : t('noEntries');
			empty.createDiv({ text: message });
			if (!this.query && this.filter.kind !== 'trash') {
				empty
					.createEl('button', { text: t('newEntry'), cls: 'mod-cta', attr: { type: 'button' } })
					.addEventListener('click', () => void this.startCreate());
			}
			return;
		}

		for (const entry of entries) {
			this.renderEntryRow(list, entry);
		}
	}

	private renderEntryRow(list: HTMLElement, entry: Entry): void {
		const row = list.createDiv({ cls: 'passovik-entry', attr: { role: 'button', tabindex: '0' } });
		row.toggleClass('is-active', entry.id === this.selectedId && !(this.draft && this.draft.id === null));

		const title = entry.title || t('untitled');
		const avatar = row.createDiv({ cls: 'passovik-avatar', text: (title.trim()[0] ?? '?').toLocaleUpperCase() });
		avatar.setCssProps({ '--passovik-hue': String(hueFor(title)) });

		const text = row.createDiv({ cls: 'passovik-entry-text' });
		text.createDiv({ cls: 'passovik-entry-title', text: title });
		const subtitle = entry.username || (entry.urls[0] ? displayHost(entry.urls[0]) : '');
		if (subtitle) {
			text.createDiv({ cls: 'passovik-entry-subtitle', text: subtitle });
		}
		if (entry.favorite) {
			setIcon(row.createSpan({ cls: 'passovik-entry-star' }), 'star');
		}
		if (entry.deletedAt === null && entry.password) {
			iconButton(row, 'copy', t('copyPassword'), () => void this.copy(entry.password, t('copiedPassword')), 'passovik-entry-copy');
		}

		const open = () => void this.selectEntry(entry.id);
		row.addEventListener('click', open);
		row.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				open();
			}
		});
	}

	private async selectEntry(id: string): Promise<void> {
		if (this.draft && !(await this.confirmDiscard())) {
			return;
		}
		this.draft = null;
		this.draftDirty = false;
		this.selectedId = id;
		this.revealPassword = false;
		if (this.narrow) {
			this.pane = 'detail';
		}
		this.renderPanes();
	}

	// ---------- Entry details ----------

	private renderDetailPane(pane: HTMLElement): void {
		if (this.draft) {
			this.renderEditor(pane, this.draft);
			return;
		}
		const entry = this.plugin.store.data.entries.find((e) => e.id === this.selectedId);
		if (!entry) {
			const empty = pane.createDiv({ cls: 'passovik-empty passovik-detail-empty' });
			setIcon(empty.createDiv({ cls: 'passovik-empty-icon' }), 'key');
			empty.createDiv({ text: t('selectEntryHint') });
			return;
		}
		this.renderEntryDetails(pane, entry);
	}

	private renderEntryDetails(pane: HTMLElement, entry: Entry): void {
		const header = pane.createDiv({ cls: 'passovik-detail-header' });
		header.createEl('h2', { cls: 'passovik-detail-title', text: entry.title || t('untitled') });
		const actions = header.createDiv({ cls: 'passovik-detail-actions' });

		if (entry.deletedAt === null) {
			iconButton(
				actions,
				'star',
				entry.favorite ? t('unfavorite') : t('favorite'),
				() => void this.toggleFavorite(entry),
				entry.favorite ? 'is-favorite' : '',
			);
			iconButton(actions, 'pencil', t('edit'), () => this.startEdit(entry));
			iconButton(actions, 'trash-2', t('moveToTrash'), () => void this.moveToTrash(entry));
		} else {
			iconButton(actions, 'undo-2', t('restore'), () => void this.restore(entry));
			iconButton(actions, 'trash-2', t('deleteForever'), () => void this.deleteForever(entry), 'mod-warning');
			pane.createDiv({ cls: 'passovik-notice', text: t('inTrashNote', { date: formatDate(entry.deletedAt) }) });
		}

		const fields = pane.createDiv({ cls: 'passovik-fields' });

		if (entry.username) {
			const value = this.renderField(fields, t('username'));
			value.createSpan({ cls: 'passovik-field-text', text: entry.username });
			iconButton(value, 'copy', t('copy'), () => void this.copy(entry.username, t('copiedUsername')));
		}

		if (entry.password) {
			const value = this.renderField(fields, t('password'));
			const text = value.createSpan({ cls: 'passovik-field-text passovik-mono' });
			const paint = () => text.setText(this.revealPassword ? entry.password : '•'.repeat(Math.min(entry.password.length, 16)));
			paint();
			const toggle = iconButton(value, this.revealPassword ? 'eye-off' : 'eye', t('showPassword'), () => {
				this.revealPassword = !this.revealPassword;
				setIcon(toggle, this.revealPassword ? 'eye-off' : 'eye');
				paint();
			});
			iconButton(value, 'copy', t('copy'), () => void this.copy(entry.password, t('copiedPassword')));
			renderStrengthMeter(fields.createDiv({ cls: 'passovik-field-extra' }), estimateStrength(entry.password).score);
		}

		if (entry.urls.length) {
			const value = this.renderField(fields, entry.urls.length > 1 ? t('links') : t('link'));
			const list = value.createDiv({ cls: 'passovik-url-list' });
			for (const url of entry.urls) {
				const row = list.createDiv({ cls: 'passovik-url-row' });
				row.createSpan({ cls: 'passovik-field-text', text: url, attr: { title: url } });
				if (toSafeUrl(url)) {
					iconButton(row, 'external-link', t('openLink'), () => this.openUrl(url));
				}
				iconButton(row, 'copy', t('copy'), () => void this.copy(url, t('copiedLink')));
			}
		}

		const groupName = this.groupName(entry.groupId);
		if (groupName) {
			this.renderField(fields, t('group')).createSpan({ cls: 'passovik-field-text', text: groupName });
		}

		if (entry.notes) {
			const value = this.renderField(fields, t('notes'));
			value.createDiv({ cls: 'passovik-field-text passovik-notes', text: entry.notes });
			iconButton(value, 'copy', t('copy'), () => void this.copy(entry.notes, t('copiedNotes')));
		}

		const meta = pane.createDiv({ cls: 'passovik-meta passovik-muted' });
		meta.createDiv({ text: t('createdAt', { date: formatDate(entry.createdAt) }) });
		meta.createDiv({ text: t('updatedAt', { date: formatDate(entry.updatedAt) }) });
	}

	private renderField(parent: HTMLElement, label: string): HTMLElement {
		const field = parent.createDiv({ cls: 'passovik-field' });
		field.createDiv({ cls: 'passovik-field-label', text: label });
		return field.createDiv({ cls: 'passovik-field-value' });
	}

	// ---------- Editor ----------

	private async startCreate(): Promise<void> {
		if (this.draft && !(await this.confirmDiscard())) {
			return;
		}
		if (this.filter.kind === 'trash') {
			this.filter = { kind: 'all' };
		}
		this.draft = {
			id: null,
			title: '',
			username: '',
			password: '',
			urls: [''],
			notes: '',
			groupId: this.filter.kind === 'group' ? this.filter.id : null,
			favorite: this.filter.kind === 'favorites',
		};
		this.draftDirty = false;
		this.revealPassword = false;
		if (this.narrow) {
			this.pane = 'detail';
		}
		this.renderPanes();
	}

	private startEdit(entry: Entry): void {
		this.draft = {
			id: entry.id,
			title: entry.title,
			username: entry.username,
			password: entry.password,
			urls: entry.urls.length ? [...entry.urls] : [''],
			notes: entry.notes,
			groupId: entry.groupId,
			favorite: entry.favorite,
		};
		this.draftDirty = false;
		this.renderPanes();
	}

	private renderEditor(pane: HTMLElement, draft: Draft): void {
		// novalidate: the browser would reject links without a scheme ("example.com"), which we accept.
		const form = pane.createEl('form', { cls: 'passovik-editor', attr: { novalidate: '' } });
		form.createEl('h2', { cls: 'passovik-detail-title', text: draft.id ? t('editEntry') : t('newEntry') });
		const changed = () => {
			this.draftDirty = true;
		};

		const textField = (label: string, value: string, onInput: (v: string) => void, secret = false) => {
			const field = form.createDiv({ cls: 'passovik-edit-field' });
			field.createEl('label', { cls: 'passovik-label', text: label });
			const input = field.createEl('input', { type: 'text', value });
			if (secret) {
				secretInputAttrs(input);
			}
			input.addEventListener('input', () => {
				onInput(input.value);
				changed();
			});
			return input;
		};

		const titleInput = textField(t('title'), draft.title, (v) => (draft.title = v));
		textField(t('username'), draft.username, (v) => (draft.username = v), true);

		// Password with show/hide, generator and strength meter
		const pwField = form.createDiv({ cls: 'passovik-edit-field' });
		pwField.createEl('label', { cls: 'passovik-label', text: t('password') });
		const pwRow = pwField.createDiv({ cls: 'passovik-input-row' });
		const pwInput = pwRow.createEl('input', {
			type: this.revealPassword ? 'text' : 'password',
			value: draft.password,
			cls: 'passovik-mono',
			attr: { autocomplete: 'new-password' },
		});
		secretInputAttrs(pwInput);
		const meterHost = pwField.createDiv();
		const paintMeter = () => {
			meterHost.empty();
			if (pwInput.value) {
				renderStrengthMeter(meterHost, estimateStrength(pwInput.value).score);
			}
		};
		pwInput.addEventListener('input', () => {
			draft.password = pwInput.value;
			changed();
			paintMeter();
		});
		const eye = iconButton(pwRow, this.revealPassword ? 'eye-off' : 'eye', t('showPassword'), () => {
			this.revealPassword = !this.revealPassword;
			pwInput.type = this.revealPassword ? 'text' : 'password';
			setIcon(eye, this.revealPassword ? 'eye-off' : 'eye');
		});
		iconButton(pwRow, 'dices', t('generatorTitle'), () =>
			new GeneratorModal(this.plugin, (generated) => {
				if (this.draft !== draft) {
					return;
				}
				draft.password = generated;
				pwInput.value = generated;
				changed();
				paintMeter();
			}).open(),
		);
		paintMeter();

		// Links
		const urlField = form.createDiv({ cls: 'passovik-edit-field' });
		urlField.createEl('label', { cls: 'passovik-label', text: t('links') });
		const urlList = urlField.createDiv({ cls: 'passovik-url-edit-list' });
		const paintUrls = () => {
			urlList.empty();
			draft.urls.forEach((url, index) => {
				const row = urlList.createDiv({ cls: 'passovik-input-row' });
				const input = row.createEl('input', { type: 'url', value: url, attr: { placeholder: t('linkPlaceholder') } });
				secretInputAttrs(input);
				input.addEventListener('input', () => {
					draft.urls[index] = input.value;
					changed();
				});
				iconButton(row, 'x', t('removeLink'), () => {
					draft.urls.splice(index, 1);
					if (!draft.urls.length) {
						draft.urls.push('');
					}
					changed();
					paintUrls();
				});
			});
		};
		paintUrls();
		const addUrl = urlField.createEl('button', { attr: { type: 'button' }, cls: 'passovik-link-button', text: t('addLink') });
		addUrl.addEventListener('click', () => {
			draft.urls.push('');
			paintUrls();
			urlList.querySelectorAll('input').item(draft.urls.length - 1)?.focus();
		});

		// Group
		const groupField = form.createDiv({ cls: 'passovik-edit-field' });
		groupField.createEl('label', { cls: 'passovik-label', text: t('group') });
		const select = groupField.createEl('select', { cls: 'dropdown' });
		select.createEl('option', { value: '', text: t('noGroup') });
		for (const node of groupTree(this.plugin.store.data.groups)) {
			select.createEl('option', { value: node.group.id, text: this.groupName(node.group.id) });
		}
		select.value = draft.groupId ?? '';
		select.addEventListener('change', () => {
			draft.groupId = select.value || null;
			changed();
		});

		// Notes
		const notesField = form.createDiv({ cls: 'passovik-edit-field' });
		notesField.createEl('label', { cls: 'passovik-label', text: t('notes') });
		const notes = notesField.createEl('textarea', { text: draft.notes, attr: { rows: '5' } });
		notes.addEventListener('input', () => {
			draft.notes = notes.value;
			changed();
		});

		// Favorite
		const favLabel = form.createEl('label', { cls: 'passovik-checkbox' });
		const fav = favLabel.createEl('input', { type: 'checkbox' });
		fav.checked = draft.favorite;
		favLabel.appendText(t('favorite'));
		fav.addEventListener('change', () => {
			draft.favorite = fav.checked;
			changed();
		});

		const actions = form.createDiv({ cls: 'passovik-form-actions' });
		actions
			.createEl('button', { attr: { type: 'button' }, text: t('cancel') })
			.addEventListener('click', () => void this.cancelEdit());
		const submit = actions.createEl('button', { attr: { type: 'submit' }, cls: 'mod-cta', text: t('save') });

		form.addEventListener('submit', (event) => {
			event.preventDefault();
			submit.disabled = true;
			void this.saveDraft(draft).finally(() => {
				submit.disabled = false;
			});
		});
		form.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				void this.cancelEdit();
			}
		});

		if (!draft.id && !Platform.isMobile) {
			window.setTimeout(() => titleInput.focus(), 0);
		}
	}

	private async saveDraft(draft: Draft): Promise<void> {
		const urls = draft.urls.map((u) => u.trim()).filter(Boolean);
		const title =
			draft.title.trim() || draft.username.trim() || (urls[0] ? displayHost(urls[0]) : '') || t('untitled');
		const fields = {
			title,
			username: draft.username.trim(),
			password: draft.password,
			urls,
			notes: draft.notes.trim(),
			groupId: draft.groupId,
			favorite: draft.favorite,
		};

		let savedId = draft.id;
		const ok = await this.plugin.updateVault((data) => {
			const existing = draft.id ? data.entries.find((e) => e.id === draft.id) : undefined;
			if (existing) {
				Object.assign(existing, fields, { updatedAt: Date.now() });
			} else {
				const entry = createEntry(fields);
				data.entries.push(entry);
				savedId = entry.id;
			}
		});
		if (!ok) {
			return;
		}
		this.draft = null;
		this.draftDirty = false;
		this.selectedId = savedId;
		this.revealPassword = false;
		if (this.narrow) {
			this.pane = 'detail';
		}
		this.renderPanes();
		new Notice(t('saved'));
	}

	private async cancelEdit(): Promise<void> {
		if (!(await this.confirmDiscard())) {
			return;
		}
		const wasNew = this.draft?.id === null;
		this.draft = null;
		this.draftDirty = false;
		if (this.narrow && wasNew) {
			this.pane = 'list';
		}
		this.renderPanes();
	}

	private async confirmDiscard(): Promise<boolean> {
		if (!this.draft || !this.draftDirty) {
			return true;
		}
		return confirmAction(this.app, {
			title: t('discardTitle'),
			message: t('discardMessage'),
			confirmText: t('discard'),
			danger: true,
		});
	}

	// ---------- Entry actions ----------

	private async toggleFavorite(entry: Entry): Promise<void> {
		await this.plugin.updateVault((data) => {
			const target = data.entries.find((e) => e.id === entry.id);
			if (target) {
				target.favorite = !target.favorite;
				target.updatedAt = Date.now();
			}
		});
	}

	private async moveToTrash(entry: Entry): Promise<void> {
		const ok = await this.plugin.updateVault((data) => {
			const target = data.entries.find((e) => e.id === entry.id);
			if (target) {
				target.deletedAt = Date.now();
				target.updatedAt = target.deletedAt;
			}
		});
		if (ok) {
			this.afterEntryRemoved();
			new Notice(t('movedToTrash'));
		}
	}

	private async restore(entry: Entry): Promise<void> {
		const ok = await this.plugin.updateVault((data) => {
			const target = data.entries.find((e) => e.id === entry.id);
			if (target) {
				target.deletedAt = null;
				target.updatedAt = Date.now();
			}
		});
		if (ok) {
			this.afterEntryRemoved();
			new Notice(t('restored'));
		}
	}

	private async deleteForever(entry: Entry): Promise<void> {
		const ok = await confirmAction(this.app, {
			title: t('deleteForever'),
			message: t('deleteForeverMessage', { title: entry.title || t('untitled') }),
			confirmText: t('delete'),
			danger: true,
		});
		if (ok && (await this.plugin.updateVault((data) => removeEntryForever(data, entry.id)))) {
			this.afterEntryRemoved();
		}
	}

	private async emptyTrash(): Promise<void> {
		const trashed = this.plugin.store.data.entries.filter((e) => e.deletedAt !== null);
		const ok = await confirmAction(this.app, {
			title: t('emptyTrash'),
			message: t('emptyTrashMessage', { count: trashed.length }),
			confirmText: t('delete'),
			danger: true,
		});
		if (ok && (await this.plugin.updateVault((data) => trashed.forEach((e) => removeEntryForever(data, e.id))))) {
			this.afterEntryRemoved();
		}
	}

	private afterEntryRemoved(): void {
		this.selectedId = null;
		if (this.narrow) {
			this.pane = 'list';
		}
		this.renderPanes();
	}

	private async copy(value: string, message: string): Promise<void> {
		try {
			await copyText(value, this.plugin.settings.clipboardClearSeconds);
			new Notice(message);
		} catch {
			new Notice(t('copyFailed'));
		}
	}

	private openUrl(value: string): void {
		const url = toSafeUrl(value);
		if (!url) {
			new Notice(t('unsafeLink'));
			return;
		}
		window.open(url, '_blank');
	}

	// ---------- Import / export ----------

	private async importFromFile(file: TFile): Promise<void> {
		let records;
		try {
			records = csvToRecords(parseCsv(await this.app.vault.read(file)));
		} catch {
			records = null;
		}
		if (!records) {
			new Notice(t('importUnrecognized'));
			return;
		}
		if (!records.length) {
			new Notice(t('importEmpty'));
			return;
		}
		const ok = await confirmAction(this.app, {
			title: t('importCsv'),
			message: t('importConfirm', { count: records.length, file: file.path }),
			confirmText: t('importAction'),
		});
		if (!ok) {
			return;
		}

		const imported = records;
		const done = await this.plugin.updateVault((data) => {
			for (const record of imported) {
				// "Работа/Проекты" creates (or reuses) nested groups.
				const groupId = record.group ? ensureGroupPath(data, record.group.split('/')) : null;
				data.entries.push(
					createEntry({
						title:
							record.title || record.username || (record.urls[0] ? displayHost(record.urls[0]) : '') || t('untitled'),
						username: record.username,
						password: record.password,
						urls: record.urls,
						notes: record.notes,
						groupId,
					}),
				);
			}
		});
		if (!done) {
			return;
		}
		new Notice(t('importDone', { count: imported.length }));

		const remove = await confirmAction(this.app, {
			title: t('importDeleteTitle'),
			message: t('importDeleteMessage', { file: file.path }),
			confirmText: t('delete'),
			danger: true,
		});
		if (remove) {
			await this.app.fileManager.trashFile(file);
		}
	}

	private async exportCsv(): Promise<void> {
		const ok = await confirmAction(this.app, {
			title: t('exportCsv'),
			message: t('exportWarning'),
			confirmText: t('exportAction'),
			danger: true,
		});
		if (!ok) {
			return;
		}
		const entries = this.plugin.store.data.entries.filter((e) => e.deletedAt === null).sort(compareEntries);
		const rows = [
			[...CSV_COLUMNS],
			...entries.map((e) => [
				e.title,
				e.username,
				e.password,
				e.urls.join('\n'),
				e.notes,
				groupPath(this.plugin.store.data.groups, e.groupId).join('/'),
			]),
		];
		const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
		const path = normalizePath(`passovik-export-${stamp}.csv`);
		try {
			if (await this.app.vault.adapter.exists(path)) {
				await this.app.vault.adapter.write(path, toCsv(rows));
			} else {
				await this.app.vault.create(path, toCsv(rows));
			}
			new Notice(t('exportDone', { path }), 10_000);
		} catch (err) {
			console.error('Passovik: export failed', err);
			new Notice(t('saveFailed'));
		}
	}
}

function hueFor(text: string): number {
	let hash = 0;
	for (const char of text) {
		hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
	}
	return hash;
}

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
