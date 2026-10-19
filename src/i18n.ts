import { getLanguage } from 'obsidian';

export type Language = 'auto' | 'ru' | 'en';
type Locale = 'ru' | 'en';

/*
 * Placeholders: {name} is replaced by a parameter.
 * Plurals: {count|one|few|many} (Russian) or {count|one|other} (English).
 */
const ru = {
	openVault: 'Открыть Passovik',
	commandOpen: 'Открыть хранилище паролей',
	commandLock: 'Заблокировать хранилище',
	commandGenerate: 'Сгенерировать пароль',

	// Lock screen
	unlockHint: 'Хранилище заблокировано. Введите мастер-пароль.',
	createHint: 'Придумайте мастер-пароль. Им шифруются все записи.',
	masterPassword: 'Мастер-пароль',
	confirmPassword: 'Повторите пароль',
	createWarning: 'Восстановить забытый мастер-пароль невозможно. Сохраните его в надёжном месте.',
	unlock: 'Разблокировать',
	createVault: 'Создать хранилище',
	working: 'Подождите…',
	wrongPassword: 'Неверный пароль',
	vaultDamaged: 'Файл хранилища повреждён или имеет неизвестный формат',
	unlockFailed: 'Не удалось открыть хранилище',
	vaultLocation: 'Файл: {path}',
	passwordTooShort: 'Пароль должен быть не короче 8 символов',
	passwordsDoNotMatch: 'Пароли не совпадают',

	// Toolbar and navigation
	back: 'Назад',
	searchPlaceholder: 'Поиск',
	newEntry: 'Новая запись',
	lockNow: 'Заблокировать',
	more: 'Ещё',
	allEntries: 'Все записи',
	favorites: 'Избранное',
	groups: 'Группы',
	newGroup: 'Новая группа',
	noGroups: 'Групп пока нет',
	trash: 'Корзина',
	groupActions: 'Действия с группой',
	renameGroup: 'Переименовать группу',
	deleteGroup: 'Удалить группу',
	deleteGroupMessage: 'Группа «{name}» будет удалена. Её записи и подгруппы перейдут на верхний уровень.',
	deleteGroupMessageParent: 'Группа «{name}» будет удалена. Её записи и подгруппы перейдут в «{parent}».',
	newSubgroup: 'Новая подгруппа',
	newSubgroupIn: 'Новая подгруппа в «{name}»',
	moveGroup: 'Переместить в…',
	moveGroupPlaceholder: 'Куда переместить «{name}»?',
	moveEntry: 'Переместить в группу…',
	moveEntryPlaceholder: 'В какую группу переместить «{title}»?',
	entryMoved: 'Запись перемещена: {group}',
	topLevel: 'Верхний уровень',
	groupNameSlash: 'В названии группы нельзя использовать «/»',
	expandGroup: 'Развернуть',
	collapseGroup: 'Свернуть',
	groupName: 'Название группы',
	groupExists: 'Группа с таким названием уже есть',

	// List
	noEntries: 'Здесь пока нет записей',
	noResults: 'Ничего не найдено',
	trashEmpty: 'Корзина пуста',
	emptyTrash: 'Очистить корзину',
	emptyTrashMessage: 'Безвозвратно удалить {count} {count|запись|записи|записей}?',
	untitled: 'Без названия',
	copyPassword: 'Копировать пароль',

	// Details
	selectEntryHint: 'Выберите запись или создайте новую',
	title: 'Название',
	username: 'Логин',
	password: 'Пароль',
	link: 'Ссылка',
	links: 'Ссылки',
	group: 'Группа',
	noGroup: 'Без группы',
	notes: 'Заметки',
	favorite: 'В избранное',
	unfavorite: 'Убрать из избранного',
	edit: 'Изменить',
	moveToTrash: 'В корзину',
	restore: 'Восстановить',
	deleteForever: 'Удалить навсегда',
	deleteForeverMessage: 'Запись «{title}» будет удалена без возможности восстановления.',
	inTrashNote: 'В корзине с {date}',
	createdAt: 'Создано: {date}',
	updatedAt: 'Изменено: {date}',
	showPassword: 'Показать или скрыть пароль',
	openLink: 'Открыть ссылку',
	copy: 'Копировать',
	copiedUsername: 'Логин скопирован',
	copiedPassword: 'Пароль скопирован',
	copiedLink: 'Ссылка скопирована',
	copiedNotes: 'Заметки скопированы',
	copyFailed: 'Не удалось скопировать',
	unsafeLink: 'Открывать можно только ссылки http и https',
	movedToTrash: 'Запись перемещена в корзину',
	restored: 'Запись восстановлена',

	// Editor
	editEntry: 'Изменение записи',
	addLink: '+ Добавить ссылку',
	linkPlaceholder: 'https://…',
	removeLink: 'Удалить ссылку',
	save: 'Сохранить',
	saved: 'Сохранено',
	cancel: 'Отмена',
	discardTitle: 'Отменить изменения?',
	discardMessage: 'Несохранённые изменения будут потеряны.',
	discard: 'Не сохранять',
	delete: 'Удалить',
	saveFailed: 'Не удалось сохранить хранилище',

	// Generator
	generatorTitle: 'Генератор паролей',
	generatorLength: 'Длина',
	generatorLowercase: 'Строчные буквы (a–z)',
	generatorUppercase: 'Заглавные буквы (A–Z)',
	generatorDigits: 'Цифры (0–9)',
	generatorSymbols: 'Символы (!@#…)',
	generatorAvoidAmbiguous: 'Без похожих символов (l, 1, O, 0)',
	generatorRegenerate: 'Ещё вариант',
	generatorUse: 'Использовать',
	strength0: 'Очень слабый',
	strength1: 'Слабый',
	strength2: 'Средний',
	strength3: 'Надёжный',
	strength4: 'Очень надёжный',

	// Master password change
	changePassword: 'Сменить мастер-пароль',
	changePasswordTitle: 'Смена мастер-пароля',
	changePasswordAction: 'Сменить пароль',
	changePasswordBackupsNote: 'Старые резервные копии останутся зашифрованы прежним паролем.',
	currentPassword: 'Текущий пароль',
	newPassword: 'Новый пароль',
	passwordChanged: 'Мастер-пароль изменён',

	// Import / export
	importCsv: 'Импорт из CSV',
	importPickFile: 'Выберите CSV-файл из хранилища',
	importNoCsv: 'В хранилище нет CSV-файлов',
	importUnrecognized: 'Не удалось распознать файл: нужны колонки с названием или паролем',
	importEmpty: 'В файле нет записей',
	importConfirm: 'Импортировать {count} {count|запись|записи|записей} из {file}?',
	importAction: 'Импортировать',
	importDone: 'Импортировано: {count}',
	importDeleteTitle: 'Удалить исходный файл?',
	importDeleteMessage: 'Файл {file} содержит пароли открытым текстом. Рекомендуется удалить его.',
	exportCsv: 'Экспорт в CSV',
	exportWarning:
		'Файл будет содержать все пароли открытым текстом и попадёт в синхронизацию хранилища. Удалите его сразу после использования.',
	exportAction: 'Экспортировать',
	exportDone: 'Сохранено в {path}. Не забудьте удалить файл.',

	// Plugin-level notices
	autoLocked: 'Passovik заблокирован из-за бездействия',
	keyChangedElsewhere: 'Мастер-пароль изменён на другом устройстве. Разблокируйте хранилище новым паролем.',

	// Settings
	settingLanguage: 'Язык интерфейса',
	languageAuto: 'Как в Obsidian',
	sectionSecurity: 'Безопасность',
	settingAutoLock: 'Автоблокировка',
	settingAutoLockDesc: 'Заблокировать хранилище после периода бездействия.',
	settingLockOnHide: 'Блокировать при сворачивании',
	settingLockOnHideDesc: 'Сразу блокировать, когда Obsidian уходит в фон. Удобно на телефоне.',
	settingClipboard: 'Очистка буфера обмена',
	settingClipboardDesc:
		'Через сколько очищать скопированное. На телефоне очистка срабатывает, только если вы не переключались в другое приложение.',
	settingChangePasswordDesc: 'Перешифровать хранилище новым паролем.',
	unlockFirst: 'Сначала разблокируйте хранилище.',
	sectionStorage: 'Хранение',
	settingFolder: 'Папка хранилища',
	settingFolderDesc:
		'Папка внутри хранилища Obsidian для vault.json и резервных копий. Имя не должно начинаться с точки, иначе её не увидят синхронизаторы. Файлы не переносятся автоматически.',
	apply: 'Применить',
	folderInvalid: 'Недопустимое имя папки',
	folderChanged: 'Папка изменена на {folder}. Хранилище заблокировано.',
	settingBackupInterval: 'Частота резервных копий',
	settingBackupIntervalDesc: 'Как часто сохранять зашифрованную копию перед изменением.',
	settingBackupKeep: 'Хранить копий',
	settingBackupKeepDesc: 'Старые копии удаляются автоматически.',
	backupsOff: 'Не делать',
	settingTrash: 'Хранить в корзине',
	settingTrashDesc: 'Через сколько записи из корзины удаляются навсегда.',
	never: 'Никогда',
	forever: 'Всегда',
	seconds: '{count} {count|секунда|секунды|секунд}',
	minutes: '{count} {count|минута|минуты|минут}',
	hours: '{count} {count|час|часа|часов}',
	days: '{count} {count|день|дня|дней}',
};

type Key = keyof typeof ru;

const en: Record<Key, string> = {
	openVault: 'Open Passovik',
	commandOpen: 'Open password vault',
	commandLock: 'Lock vault',
	commandGenerate: 'Generate password',

	unlockHint: 'The vault is locked. Enter your master password.',
	createHint: 'Choose a master password. It encrypts every entry.',
	masterPassword: 'Master password',
	confirmPassword: 'Repeat password',
	createWarning: 'A forgotten master password cannot be recovered. Keep it somewhere safe.',
	unlock: 'Unlock',
	createVault: 'Create vault',
	working: 'Please wait…',
	wrongPassword: 'Wrong password',
	vaultDamaged: 'The vault file is damaged or has an unknown format',
	unlockFailed: 'Could not open the vault',
	vaultLocation: 'File: {path}',
	passwordTooShort: 'The password must be at least 8 characters long',
	passwordsDoNotMatch: 'The passwords do not match',

	back: 'Back',
	searchPlaceholder: 'Search',
	newEntry: 'New entry',
	lockNow: 'Lock',
	more: 'More',
	allEntries: 'All entries',
	favorites: 'Favorites',
	groups: 'Groups',
	newGroup: 'New group',
	noGroups: 'No groups yet',
	trash: 'Trash',
	groupActions: 'Group actions',
	renameGroup: 'Rename group',
	deleteGroup: 'Delete group',
	deleteGroupMessage: 'The group "{name}" will be deleted. Its entries and subgroups move to the top level.',
	deleteGroupMessageParent: 'The group "{name}" will be deleted. Its entries and subgroups move to "{parent}".',
	newSubgroup: 'New subgroup',
	newSubgroupIn: 'New subgroup in "{name}"',
	moveGroup: 'Move to…',
	moveGroupPlaceholder: 'Where should "{name}" go?',
	moveEntry: 'Move to group…',
	moveEntryPlaceholder: 'Which group should "{title}" go to?',
	entryMoved: 'Entry moved to {group}',
	topLevel: 'Top level',
	groupNameSlash: 'Group names cannot contain "/"',
	expandGroup: 'Expand',
	collapseGroup: 'Collapse',
	groupName: 'Group name',
	groupExists: 'A group with this name already exists',

	noEntries: 'No entries here yet',
	noResults: 'Nothing found',
	trashEmpty: 'The trash is empty',
	emptyTrash: 'Empty trash',
	emptyTrashMessage: 'Permanently delete {count} {count|entry|entries}?',
	untitled: 'Untitled',
	copyPassword: 'Copy password',

	selectEntryHint: 'Select an entry or create a new one',
	title: 'Title',
	username: 'Username',
	password: 'Password',
	link: 'Link',
	links: 'Links',
	group: 'Group',
	noGroup: 'No group',
	notes: 'Notes',
	favorite: 'Add to favorites',
	unfavorite: 'Remove from favorites',
	edit: 'Edit',
	moveToTrash: 'Move to trash',
	restore: 'Restore',
	deleteForever: 'Delete forever',
	deleteForeverMessage: 'The entry "{title}" will be deleted permanently.',
	inTrashNote: 'In the trash since {date}',
	createdAt: 'Created: {date}',
	updatedAt: 'Modified: {date}',
	showPassword: 'Show or hide password',
	openLink: 'Open link',
	copy: 'Copy',
	copiedUsername: 'Username copied',
	copiedPassword: 'Password copied',
	copiedLink: 'Link copied',
	copiedNotes: 'Notes copied',
	copyFailed: 'Could not copy',
	unsafeLink: 'Only http and https links can be opened',
	movedToTrash: 'Entry moved to the trash',
	restored: 'Entry restored',

	editEntry: 'Edit entry',
	addLink: '+ Add link',
	linkPlaceholder: 'https://…',
	removeLink: 'Remove link',
	save: 'Save',
	saved: 'Saved',
	cancel: 'Cancel',
	discardTitle: 'Discard changes?',
	discardMessage: 'Unsaved changes will be lost.',
	discard: 'Discard',
	delete: 'Delete',
	saveFailed: 'Could not save the vault',

	generatorTitle: 'Password generator',
	generatorLength: 'Length',
	generatorLowercase: 'Lowercase letters (a–z)',
	generatorUppercase: 'Uppercase letters (A–Z)',
	generatorDigits: 'Digits (0–9)',
	generatorSymbols: 'Symbols (!@#…)',
	generatorAvoidAmbiguous: 'Avoid look-alike characters (l, 1, O, 0)',
	generatorRegenerate: 'Another one',
	generatorUse: 'Use',
	strength0: 'Very weak',
	strength1: 'Weak',
	strength2: 'Fair',
	strength3: 'Strong',
	strength4: 'Very strong',

	changePassword: 'Change master password',
	changePasswordTitle: 'Change master password',
	changePasswordAction: 'Change password',
	changePasswordBackupsNote: 'Existing backups stay encrypted with the previous password.',
	currentPassword: 'Current password',
	newPassword: 'New password',
	passwordChanged: 'Master password changed',

	importCsv: 'Import from CSV',
	importPickFile: 'Choose a CSV file from the vault',
	importNoCsv: 'There are no CSV files in the vault',
	importUnrecognized: 'Could not read the file: a title or password column is required',
	importEmpty: 'The file has no entries',
	importConfirm: 'Import {count} {count|entry|entries} from {file}?',
	importAction: 'Import',
	importDone: 'Imported: {count}',
	importDeleteTitle: 'Delete the source file?',
	importDeleteMessage: 'The file {file} contains passwords in plain text. Deleting it is recommended.',
	exportCsv: 'Export to CSV',
	exportWarning:
		'The file will contain every password in plain text and will be synced with your vault. Delete it right after use.',
	exportAction: 'Export',
	exportDone: 'Saved to {path}. Remember to delete the file.',

	autoLocked: 'Passovik was locked after inactivity',
	keyChangedElsewhere: 'The master password was changed on another device. Unlock with the new password.',

	settingLanguage: 'Interface language',
	languageAuto: 'Same as Obsidian',
	sectionSecurity: 'Security',
	settingAutoLock: 'Auto-lock',
	settingAutoLockDesc: 'Lock the vault after a period of inactivity.',
	settingLockOnHide: 'Lock when hidden',
	settingLockOnHideDesc: 'Lock as soon as Obsidian goes to the background. Useful on phones.',
	settingClipboard: 'Clear clipboard',
	settingClipboardDesc:
		'How long copied values stay in the clipboard. On mobile it is cleared only if you did not switch to another app.',
	settingChangePasswordDesc: 'Re-encrypt the vault with a new password.',
	unlockFirst: 'Unlock the vault first.',
	sectionStorage: 'Storage',
	settingFolder: 'Vault folder',
	settingFolderDesc:
		'Folder inside your Obsidian vault for vault.json and backups. It must not start with a dot, or sync tools will skip it. Files are not moved automatically.',
	apply: 'Apply',
	folderInvalid: 'Invalid folder name',
	folderChanged: 'Folder changed to {folder}. The vault is locked.',
	settingBackupInterval: 'Backup frequency',
	settingBackupIntervalDesc: 'How often to keep an encrypted copy before a change.',
	settingBackupKeep: 'Backups to keep',
	settingBackupKeepDesc: 'Older backups are removed automatically.',
	backupsOff: 'None',
	settingTrash: 'Keep in trash',
	settingTrashDesc: 'How long entries stay in the trash before they are deleted for good.',
	never: 'Never',
	forever: 'Forever',
	seconds: '{count} {count|second|seconds}',
	minutes: '{count} {count|minute|minutes}',
	hours: '{count} {count|hour|hours}',
	days: '{count} {count|day|days}',
};

const dictionaries: Record<Locale, Record<Key, string>> = { ru, en };
let locale: Locale = 'ru';

export function setLanguage(language: Language): void {
	locale = language === 'auto' ? (getLanguage().toLowerCase().startsWith('ru') ? 'ru' : 'en') : language;
}

function pluralIndex(count: number): number {
	const n = Math.abs(count);
	if (locale === 'en') {
		return n === 1 ? 0 : 1;
	}
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return 0;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
	return 2;
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
	return dictionaries[locale][key]
		.replace(/\{(\w+)\|([^}]+)\}/g, (_, name: string, forms: string) => {
			const options = forms.split('|');
			const index = Math.min(pluralIndex(Number(params[name] ?? 0)), options.length - 1);
			return options[index] ?? '';
		})
		.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
