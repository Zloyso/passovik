/** CSV reading/writing (RFC 4180) and mapping of common password-export columns. */

export function parseCsv(text: string): string[][] {
	const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
	const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;

	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (quoted) {
			if (char === '"') {
				if (source[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === delimiter) {
			row.push(field);
			field = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && source[i + 1] === '\n') {
				i++;
			}
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += char;
		}
	}
	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function escapeField(value: string): string {
	return /[",;\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
	return rows.map((row) => row.map(escapeField).join(',')).join('\r\n') + '\r\n';
}

export interface CsvRecord {
	title: string;
	username: string;
	password: string;
	urls: string[];
	notes: string;
	group: string;
}

export const CSV_COLUMNS = ['title', 'username', 'password', 'url', 'notes', 'group'] as const;

const ALIASES: Record<keyof CsvRecord, string[]> = {
	title: ['title', 'name', 'название', 'заголовок', 'имя записи'],
	username: ['username', 'user', 'login', 'login_username', 'email', 'логин', 'имя пользователя', 'пользователь'],
	password: ['password', 'login_password', 'pass', 'пароль'],
	urls: ['url', 'urls', 'uri', 'link', 'links', 'website', 'login_uri', 'ссылка', 'ссылки', 'сайт', 'адрес'],
	notes: ['notes', 'note', 'comment', 'comments', 'extra', 'заметки', 'заметка', 'примечание', 'комментарий'],
	group: ['group', 'groups', 'folder', 'category', 'grouping', 'группа', 'группы', 'теги групп', 'папка', 'категория'],
};

const normalizeHeader = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

/** Maps CSV rows (first row = header) to records. Returns null when no password or title column is found. */
export function csvToRecords(rows: string[][]): CsvRecord[] | null {
	const [header, ...body] = rows;
	if (!header) {
		return null;
	}
	const names = header.map(normalizeHeader);
	const column = (field: keyof CsvRecord) => names.findIndex((name) => ALIASES[field].includes(name));
	const index = {
		title: column('title'),
		username: column('username'),
		password: column('password'),
		urls: column('urls'),
		notes: column('notes'),
		group: column('group'),
	};
	if (index.password < 0 && index.title < 0) {
		return null;
	}
	const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

	return body
		.map((row) => {
			const urls = cell(row, index.urls)
				.split(/\r?\n|\s+\|\s+/)
				.map((u) => u.trim())
				.filter(Boolean);
			return {
				title: cell(row, index.title),
				username: cell(row, index.username),
				password: index.password >= 0 ? (row[index.password] ?? '') : '',
				urls,
				notes: index.notes >= 0 ? (row[index.notes] ?? '').trim() : '',
				group: cell(row, index.group).split(/\r?\n|,\s*/)[0]?.trim() ?? '',
			};
		})
		.filter((record) => record.title || record.username || record.password || record.urls.length);
}
