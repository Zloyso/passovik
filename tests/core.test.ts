import { describe, expect, it } from 'vitest';
import { deriveKey, newKdfParams, seal, unseal } from '../src/crypto';
import { csvToRecords, parseCsv, toCsv } from '../src/csv';
import { estimateStrength, generatePassword } from '../src/generator';
import {
	createEntry,
	createGroup,
	descendantIds,
	emptyVault,
	ensureGroupPath,
	groupPath,
	groupTree,
	matchesFilter,
	matchesQuery,
	moveGroup,
	mergeVaults,
	normalizeVault,
	removeEntryForever,
	removeGroup,
	runMaintenance,
} from '../src/model';
import { toSafeUrl } from '../src/url';
import { decryptVault, encryptVault, parseVaultFile, serializeVaultFile, VaultFormatError } from '../src/vault-file';

// Fast KDF for tests; production uses 600k iterations.
const testKdf = () => newKdfParams(100_000);

describe('crypto', () => {
	it('round-trips and rejects a wrong password', async () => {
		const kdf = testKdf();
		const key = await deriveKey('correct horse', kdf);
		const sealed = await seal(key, 'секрет', 'aad');
		expect(await unseal(key, sealed, 'aad')).toBe('секрет');

		const wrong = await deriveKey('wrong horse', kdf);
		await expect(unseal(wrong, sealed, 'aad')).rejects.toThrow();
		await expect(unseal(key, sealed, 'other aad')).rejects.toThrow();
	});

	it('treats NFC and NFD forms of a password as the same', async () => {
		const kdf = testKdf();
		const nfc = await deriveKey('ёжик', kdf);
		const nfd = await deriveKey('ёжик'.normalize('NFD'), kdf);
		const sealed = await seal(nfc, 'x', 'aad');
		expect(await unseal(nfd, sealed, 'aad')).toBe('x');
	});
});

describe('vault file', () => {
	it('encrypts, serializes, parses and decrypts', async () => {
		const kdf = testKdf();
		const key = await deriveKey('pw', kdf);
		const data = emptyVault();
		data.entries.push(createEntry({ title: 'Почта', password: 'p@ss' }));

		const text = serializeVaultFile(await encryptVault(key, kdf, data));
		expect(text).not.toContain('p@ss');
		expect(text).not.toContain('Почта');

		const restored = await decryptVault(key, parseVaultFile(text));
		expect(restored.entries[0]?.password).toBe('p@ss');
	});

	it('fails when the salt in the header is changed', async () => {
		const kdf = testKdf();
		const key = await deriveKey('pw', kdf);
		const file = await encryptVault(key, kdf, emptyVault());
		const tampered = { ...file, kdf: { ...file.kdf, salt: newKdfParams().salt } };
		await expect(decryptVault(key, tampered)).rejects.toThrow();
	});

	it('rejects foreign or damaged files', () => {
		expect(() => parseVaultFile('not json')).toThrow(VaultFormatError);
		expect(() => parseVaultFile('{"format":"other"}')).toThrow(VaultFormatError);
		expect(() => parseVaultFile('{"format":"passovik-vault","version":1}')).toThrow(VaultFormatError);
	});
});

describe('merge', () => {
	it('keeps the newer version of each entry', () => {
		const base = createEntry({ title: 'A' }, 1000);
		const local = emptyVault();
		const remote = emptyVault();
		local.entries.push({ ...base, title: 'local', updatedAt: 3000 });
		remote.entries.push({ ...base, title: 'remote', updatedAt: 2000 });
		remote.entries.push(createEntry({ title: 'only remote' }, 1500));

		const merged = mergeVaults(local, remote);
		expect(merged.entries.map((e) => e.title).sort()).toEqual(['local', 'only remote']);
	});

	it('does not resurrect permanently removed entries', () => {
		const entry = createEntry({ title: 'gone' }, 1000);
		const local = emptyVault();
		const remote = emptyVault();
		remote.entries.push(entry);
		local.entries.push(entry);
		removeEntryForever(local, entry.id, 2000);

		expect(mergeVaults(local, remote).entries).toHaveLength(0);
		expect(mergeVaults(remote, local).entries).toHaveLength(0);
	});

	it('keeps an entry edited after it was removed elsewhere', () => {
		const entry = createEntry({ title: 'x' }, 1000);
		const local = emptyVault();
		const remote = emptyVault();
		local.entries.push(entry);
		removeEntryForever(local, entry.id, 2000);
		remote.entries.push({ ...entry, title: 'edited', updatedAt: 3000 });

		const merged = mergeVaults(local, remote);
		expect(merged.entries[0]?.title).toBe('edited');
		expect(merged.tombstones[entry.id]).toBeUndefined();
	});
});

describe('model', () => {
	it('moves entries out of a removed group', () => {
		const data = emptyVault();
		const group = createGroup('Работа', null, 1000);
		data.groups.push(group);
		data.entries.push(createEntry({ title: 'a', groupId: group.id }, 1000));
		removeGroup(data, group.id, 2000);
		expect(data.groups).toHaveLength(0);
		expect(data.entries[0]?.groupId).toBeNull();
	});

	it('purges old trash and leaves a tombstone', () => {
		const day = 24 * 60 * 60 * 1000;
		const now = 100 * day;
		const data = emptyVault();
		const old = createEntry({ title: 'old', deletedAt: now - 40 * day }, 0);
		const fresh = createEntry({ title: 'fresh', deletedAt: now - day }, 0);
		data.entries.push(old, fresh);
		runMaintenance(data, 30, now);
		expect(data.entries.map((e) => e.title)).toEqual(['fresh']);
		expect(data.tombstones[old.id]).toBe(now);
	});

	it('normalizes junk safely', () => {
		const data = normalizeVault({ entries: [{ id: 'a', title: 5 }, null, { title: 'no id' }], groups: 'x' });
		expect(data.entries).toHaveLength(1);
		expect(data.entries[0]?.title).toBe('');
		expect(data.groups).toEqual([]);
	});

	it('searches across fields with all terms', () => {
		const entry = createEntry({ title: 'Госуслуги', username: 'ivan', urls: ['https://gosuslugi.ru'] });
		expect(matchesQuery(entry, 'гос ivan')).toBe(true);
		expect(matchesQuery(entry, 'gosuslugi')).toBe(true);
		expect(matchesQuery(entry, 'bank')).toBe(false);
	});
});

describe('nested groups', () => {
	const tree = () => {
		const data = emptyVault();
		const work = createGroup('Работа', null, 1);
		const projects = createGroup('Проекты', work.id, 1);
		const client = createGroup('Клиент', projects.id, 1);
		const home = createGroup('Дом', null, 1);
		data.groups.push(work, projects, client, home);
		return { data, work, projects, client, home };
	};

	it('builds a sorted depth-first tree and paths', () => {
		const { data, client } = tree();
		expect(groupTree(data.groups).map((n) => `${'-'.repeat(n.depth)}${n.group.name}${n.hasChildren ? '+' : ''}`)).toEqual([
			'Дом',
			'Работа+',
			'-Проекты+',
			'--Клиент',
		]);
		expect(groupPath(data.groups, client.id)).toEqual(['Работа', 'Проекты', 'Клиент']);
	});

	it('includes subgroups in a group filter', () => {
		const { data, work, client, home } = tree();
		const entry = createEntry({ title: 'deep', groupId: client.id });
		expect(matchesFilter(entry, { kind: 'group', id: work.id }, descendantIds(data.groups, work.id))).toBe(true);
		expect(matchesFilter(entry, { kind: 'group', id: home.id }, descendantIds(data.groups, home.id))).toBe(false);
	});

	it('refuses to move a group into its own subgroup', () => {
		const { data, work, client, home } = tree();
		expect(moveGroup(data, work.id, client.id)).toBe(false);
		expect(moveGroup(data, client.id, home.id)).toBe(true);
		expect(groupPath(data.groups, client.id)).toEqual(['Дом', 'Клиент']);
	});

	it('survives cycles and missing parents from merged edits', () => {
		const a = { ...createGroup('A', null, 1), id: 'a', parentId: 'b' };
		const b = { ...createGroup('B', null, 1), id: 'b', parentId: 'a' };
		const orphan = { ...createGroup('Orphan', null, 1), id: 'o', parentId: 'gone' };
		const nodes = groupTree([a, b, orphan]);
		expect(nodes).toHaveLength(3);
		expect(nodes.find((n) => n.group.id === 'o')?.depth).toBe(0);
		expect(descendantIds([a, b], 'a').size).toBeLessThanOrEqual(2);
	});

	it('moves children and entries up when a group is removed', () => {
		const { data, work, projects, client } = tree();
		data.entries.push(createEntry({ title: 'x', groupId: projects.id }));
		removeGroup(data, projects.id, 5);
		expect(data.groups.find((g) => g.id === client.id)?.parentId).toBe(work.id);
		expect(data.entries[0]?.groupId).toBe(work.id);
	});

	it('creates missing groups along a path and reuses existing ones', () => {
		const { data, work, projects } = tree();
		expect(ensureGroupPath(data, ['работа', 'Проекты'])).toBe(projects.id);
		const id = ensureGroupPath(data, ['Работа', 'Новая', 'Глубже']);
		expect(groupPath(data.groups, id)).toEqual(['Работа', 'Новая', 'Глубже']);
		expect(data.groups.filter((g) => g.parentId === work.id).map((g) => g.name).sort()).toEqual(['Новая', 'Проекты']);
	});

	it('reads old vaults without parentId as top-level groups', () => {
		const data = normalizeVault({ groups: [{ id: 'g', name: 'Old' }] });
		expect(data.groups[0]?.parentId).toBeNull();
	});
});

describe('generator', () => {
	it('respects length and includes every selected class', () => {
		for (let i = 0; i < 200; i++) {
			const pw = generatePassword({
				length: 12,
				lowercase: true,
				uppercase: true,
				digits: true,
				symbols: true,
				avoidAmbiguous: true,
			});
			expect(pw).toHaveLength(12);
			expect(pw).toMatch(/[a-z]/);
			expect(pw).toMatch(/[A-Z]/);
			expect(pw).toMatch(/[0-9]/);
			expect(pw).toMatch(/[^a-zA-Z0-9]/);
			expect(pw).not.toMatch(/[Il1O0o|`'"]/);
		}
	});

	it('clamps length and falls back to lowercase', () => {
		const pw = generatePassword({
			length: 3,
			lowercase: false,
			uppercase: false,
			digits: false,
			symbols: false,
			avoidAmbiguous: false,
		});
		expect(pw).toMatch(/^[a-z]{8}$/);
	});

	it('rates passwords sensibly', () => {
		expect(estimateStrength('').score).toBe(0);
		expect(estimateStrength('123456').score).toBe(0);
		expect(estimateStrength('aaaaaaaaaaaaaaaaaaaa').score).toBeLessThan(2);
		expect(estimateStrength('vT7#qL9!zR2@wX5$').score).toBe(4);
	});
});

describe('csv', () => {
	it('parses quotes, newlines and BOM', () => {
		const rows = parseCsv('\uFEFFname,password,note\r\n"A, B","p""w","line1\nline2"\r\n');
		expect(rows).toEqual([
			['name', 'password', 'note'],
			['A, B', 'p"w', 'line1\nline2'],
		]);
	});

	it('detects semicolons and round-trips', () => {
		expect(parseCsv('a;b\n1;2')).toEqual([
			['a', 'b'],
			['1', '2'],
		]);
		const rows = [['t', 'x,y', 'q"q', 'multi\nline']];
		expect(parseCsv(toCsv(rows))).toEqual(rows);
	});

	it('maps English and Russian headers', () => {
		const browser = csvToRecords(parseCsv('name,url,username,password,note\nSite,https://a.ru,me,pw,hi'));
		expect(browser?.[0]).toMatchObject({ title: 'Site', urls: ['https://a.ru'], username: 'me', password: 'pw', notes: 'hi' });

		const russian = csvToRecords(
			parseCsv('Название,Имя пользователя,Пароль,Ссылка,Заметки,Теги групп\nПочта,ivan,secret,mail.ru,,Личное'),
		);
		expect(russian?.[0]).toMatchObject({ title: 'Почта', username: 'ivan', password: 'secret', group: 'Личное' });

		expect(csvToRecords(parseCsv('foo,bar\n1,2'))).toBeNull();
	});
});

describe('url', () => {
	it('allows only http and https', () => {
		expect(toSafeUrl('https://bank.ru/login')).toBe('https://bank.ru/login');
		expect(toSafeUrl('example.com')).toBe('https://example.com/');
		expect(toSafeUrl('localhost:3000')).toBe('https://localhost:3000/');
		expect(toSafeUrl('file:///C:/Windows/calc.exe')).toBeNull();
		expect(toSafeUrl('javascript:alert(1)')).toBeNull();
		expect(toSafeUrl('ftp://x.ru')).toBeNull();
		expect(toSafeUrl('   ')).toBeNull();
	});
});
