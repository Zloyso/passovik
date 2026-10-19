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

export function createGroup(name: string, now = Date.now()): Group {
	return { id: newId(), name, createdAt: now, updatedAt: now };
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

export function removeGroup(data: VaultData, id: string, now = Date.now()): void {
	data.groups = data.groups.filter((group) => group.id !== id);
	data.tombstones[id] = now;
	for (const entry of data.entries) {
		if (entry.groupId === id) {
			entry.groupId = null;
			entry.updatedAt = now;
		}
	}
}

// ---------- Queries ----------

export type EntryFilter =
	| { kind: 'all' }
	| { kind: 'favorites' }
	| { kind: 'trash' }
	| { kind: 'group'; id: string };

export function matchesFilter(entry: Entry, filter: EntryFilter): boolean {
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
			return entry.groupId === filter.id;
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
