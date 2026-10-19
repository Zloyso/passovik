/**
 * Vault data model and pure operations on it (no Obsidian dependencies).
 *
 * Every record carries `updatedAt`, so two copies of a vault edited on different
 * devices can be merged record by record. Permanently removed records leave a
 * tombstone so the merge does not bring them back.
 */

export interface Entry {
	id: string;
	title: string;
	username: string;
	password: string;
	urls: string[];
	notes: string;
	groupId: string | null;
	favorite: boolean;
	createdAt: number;
	updatedAt: number;
	/** Set when the entry is in the trash. */
	deletedAt: number | null;
}

export interface Group {
	id: string;
	name: string;
	/** Parent group; null for top-level groups. */
	parentId: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface VaultData {
	groups: Group[];
	entries: Entry[];
	/** id -> time of permanent removal */
	tombstones: Record<string, number>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TOMBSTONE_TTL_DAYS = 180;

export function emptyVault(): VaultData {
	return { groups: [], entries: [], tombstones: {} };
}

export function newId(): string {
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createEntry(fields: Partial<Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>>, now = Date.now()): Entry {
	return {
		id: newId(),
		title: fields.title ?? '',
		username: fields.username ?? '',
		password: fields.password ?? '',
		urls: fields.urls ?? [],
		notes: fields.notes ?? '',
		groupId: fields.groupId ?? null,
		favorite: fields.favorite ?? false,
		createdAt: now,
		updatedAt: now,
		deletedAt: fields.deletedAt ?? null,
	};
}

export function createGroup(name: string, parentId: string | null = null, now = Date.now()): Group {
	return { id: newId(), name, parentId, createdAt: now, updatedAt: now };
}

// ---------- Defensive parsing of decrypted data ----------

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const asNumber = (value: unknown, fallback: number): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function parseEntry(raw: unknown, now: number): Entry | null {
	if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) {
		return null;
	}
	const createdAt = asNumber(raw.createdAt, now);
	return {
		id: raw.id,
		title: asString(raw.title),
		username: asString(raw.username),
		password: asString(raw.password),
		urls: Array.isArray(raw.urls) ? raw.urls.filter((u): u is string => typeof u === 'string') : [],
		notes: asString(raw.notes),
		groupId: typeof raw.groupId === 'string' && raw.groupId ? raw.groupId : null,
		favorite: raw.favorite === true,
		createdAt,
		updatedAt: asNumber(raw.updatedAt, createdAt),
		deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : null,
	};
}

function parseGroup(raw: unknown, now: number): Group | null {
	if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) {
		return null;
	}
	const createdAt = asNumber(raw.createdAt, now);
	return {
		id: raw.id,
		name: asString(raw.name),
		parentId: typeof raw.parentId === 'string' && raw.parentId && raw.parentId !== raw.id ? raw.parentId : null,
		createdAt,
		updatedAt: asNumber(raw.updatedAt, createdAt),
	};
}

export function normalizeVault(raw: unknown, now = Date.now()): VaultData {
	if (!isRecord(raw)) {
		return emptyVault();
	}
	const entries = Array.isArray(raw.entries)
		? raw.entries.map((e) => parseEntry(e, now)).filter((e): e is Entry => e !== null)
		: [];
	const groups = Array.isArray(raw.groups)
		? raw.groups.map((g) => parseGroup(g, now)).filter((g): g is Group => g !== null)
		: [];
	const tombstones: Record<string, number> = {};
	if (isRecord(raw.tombstones)) {
		for (const [id, time] of Object.entries(raw.tombstones)) {
			if (typeof time === 'number') {
				tombstones[id] = time;
			}
		}
	}
	return { groups, entries, tombstones };
}

// ---------- Merge ----------

function mergeById<T extends { id: string; updatedAt: number }>(local: T[], remote: T[]): T[] {
	const merged = new Map<string, T>();
	for (const item of remote) {
		merged.set(item.id, item);
	}
	for (const item of local) {
		const other = merged.get(item.id);
		if (!other || item.updatedAt >= other.updatedAt) {
			merged.set(item.id, item);
		}
	}
	return [...merged.values()];
}

/** Record-level last-writer-wins merge of two copies of the same vault. */
export function mergeVaults(local: VaultData, remote: VaultData): VaultData {
	const tombstones: Record<string, number> = { ...remote.tombstones };
	for (const [id, time] of Object.entries(local.tombstones)) {
		tombstones[id] = Math.max(time, tombstones[id] ?? 0);
	}

	const alive = <T extends { id: string; updatedAt: number }>(item: T) => {
		const removedAt = tombstones[item.id];
		if (removedAt === undefined) {
			return true;
		}
		if (item.updatedAt > removedAt) {
			// Edited after removal elsewhere: keep the edit.
			delete tombstones[item.id];
			return true;
		}
		return false;
	};

	return {
		groups: mergeById(local.groups, remote.groups).filter(alive),
		entries: mergeById(local.entries, remote.entries).filter(alive),
		tombstones,
	};
}

// ---------- Maintenance ----------

/** Removes trash older than `trashDays` (0 = keep forever) and expired tombstones. Mutates `data`. */
export function runMaintenance(data: VaultData, trashDays: number, now = Date.now()): void {
	if (trashDays > 0) {
		const cutoff = now - trashDays * DAY_MS;
		data.entries = data.entries.filter((entry) => {
			if (entry.deletedAt !== null && entry.deletedAt < cutoff) {
				data.tombstones[entry.id] = now;
				return false;
			}
			return true;
		});
	}
	const tombstoneCutoff = now - TOMBSTONE_TTL_DAYS * DAY_MS;
	for (const [id, time] of Object.entries(data.tombstones)) {
		if (time < tombstoneCutoff) {
			delete data.tombstones[id];
		}
	}
}

export function removeEntryForever(data: VaultData, id: string, now = Date.now()): void {
	data.entries = data.entries.filter((entry) => entry.id !== id);
	data.tombstones[id] = now;
}

/** Removes a group; its entries and subgroups move up to the group's parent. */
export function removeGroup(data: VaultData, id: string, now = Date.now()): void {
	const parentId = resolveParents(data.groups).get(id) ?? null;
	data.groups = data.groups.filter((group) => group.id !== id);
	data.tombstones[id] = now;
	for (const group of data.groups) {
		if (group.parentId === id) {
			group.parentId = parentId;
			group.updatedAt = now;
		}
	}
	for (const entry of data.entries) {
		if (entry.groupId === id) {
			entry.groupId = parentId;
			entry.updatedAt = now;
		}
	}
}

/** Moves a group under another one (null = top level). Refuses to create a cycle. */
export function moveGroup(data: VaultData, id: string, parentId: string | null, now = Date.now()): boolean {
	if (parentId !== null && descendantIds(data.groups, id).has(parentId)) {
		return false;
	}
	const group = data.groups.find((g) => g.id === id);
	if (!group) {
		return false;
	}
	group.parentId = parentId;
	group.updatedAt = now;
	return true;
}

// ---------- Group tree ----------

/**
 * Effective parent of every group. Parents that are missing (removed on another device)
 * or that would form a cycle (conflicting moves merged from two devices) become top level.
 */
export function resolveParents(groups: Group[]): Map<string, string | null> {
	const byId = new Map(groups.map((g) => [g.id, g]));
	const result = new Map<string, string | null>();
	for (const group of groups) {
		let parent = group.parentId && byId.has(group.parentId) ? group.parentId : null;
		// Walk up; if we come back to this group, the chain is a cycle.
		const seen = new Set([group.id]);
		let cursor = parent;
		while (cursor) {
			if (seen.has(cursor)) {
				parent = null;
				break;
			}
			seen.add(cursor);
			const next = byId.get(cursor)?.parentId;
			cursor = next && byId.has(next) ? next : null;
		}
		result.set(group.id, parent);
	}
	return result;
}

/** The group and all groups nested in it. */
export function descendantIds(groups: Group[], id: string): Set<string> {
	const parents = resolveParents(groups);
	const result = new Set([id]);
	let added = true;
	while (added) {
		added = false;
		for (const [child, parent] of parents) {
			if (parent && result.has(parent) && !result.has(child)) {
				result.add(child);
				added = true;
			}
		}
	}
	return result;
}

/** Names from the top-level group down to the given one. */
export function groupPath(groups: Group[], id: string | null): string[] {
	const parents = resolveParents(groups);
	const byId = new Map(groups.map((g) => [g.id, g]));
	const path: string[] = [];
	let cursor = id && byId.has(id) ? id : null;
	while (cursor) {
		path.unshift(byId.get(cursor)?.name ?? '');
		cursor = parents.get(cursor) ?? null;
	}
	return path;
}

export interface GroupNode {
	group: Group;
	depth: number;
	hasChildren: boolean;
}

/** Groups in display order: depth-first, siblings sorted by name. */
export function groupTree(groups: Group[]): GroupNode[] {
	const parents = resolveParents(groups);
	const children = new Map<string | null, Group[]>();
	for (const group of groups) {
		const parent = parents.get(group.id) ?? null;
		children.set(parent, [...(children.get(parent) ?? []), group]);
	}
	const result: GroupNode[] = [];
	const visit = (parent: string | null, depth: number) => {
		for (const group of (children.get(parent) ?? []).sort(compareGroups)) {
			const kids = children.get(group.id) ?? [];
			result.push({ group, depth, hasChildren: kids.length > 0 });
			visit(group.id, depth + 1);
		}
	};
	visit(null, 0);
	return result;
}

/** Finds or creates the chain of groups for a path like ["Работа", "Проекты"]. Returns the last id. */
export function ensureGroupPath(data: VaultData, path: string[], now = Date.now()): string | null {
	let parentId: string | null = null;
	const parents = resolveParents(data.groups);
	for (const rawName of path) {
		const name = rawName.trim();
		if (!name) {
			continue;
		}
		const lower = name.toLocaleLowerCase();
		const existing = data.groups.find(
			(g) => (parents.get(g.id) ?? null) === parentId && g.name.toLocaleLowerCase() === lower,
		);
		if (existing) {
			parentId = existing.id;
		} else {
			const group = createGroup(name, parentId, now);
			data.groups.push(group);
			parents.set(group.id, parentId);
			parentId = group.id;
		}
	}
	return parentId;
}

// ---------- Queries ----------

export type EntryFilter =
	| { kind: 'all' }
	| { kind: 'favorites' }
	| { kind: 'trash' }
	| { kind: 'group'; id: string };

/** `groupScope`: ids of the selected group and its subgroups (see descendantIds). */
export function matchesFilter(entry: Entry, filter: EntryFilter, groupScope?: Set<string>): boolean {
	if (filter.kind === 'trash') {
		return entry.deletedAt !== null;
	}
	if (entry.deletedAt !== null) {
		return false;
	}
	switch (filter.kind) {
		case 'all':
			return true;
		case 'favorites':
			return entry.favorite;
		case 'group':
			return entry.groupId !== null && (groupScope ? groupScope.has(entry.groupId) : entry.groupId === filter.id);
	}
}

export function matchesQuery(entry: Entry, query: string, groupName = ''): boolean {
	const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) {
		return true;
	}
	const haystack = [entry.title, entry.username, entry.notes, groupName, ...entry.urls].join('\n').toLocaleLowerCase();
	return terms.every((term) => haystack.includes(term));
}

export function compareEntries(a: Entry, b: Entry): number {
	if (a.favorite !== b.favorite) {
		return a.favorite ? -1 : 1;
	}
	return a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
}

export function compareGroups(a: Group, b: Group): number {
	return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}
