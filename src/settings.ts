import { DEFAULT_GENERATOR_OPTIONS, type GeneratorOptions } from './generator';
import type { Language } from './i18n';

export interface PassovikSettings {
	language: Language;
	/** Vault folder relative to the vault root. Must not start with a dot, or sync tools skip it. */
	folder: string;
	/** 0 = never */
	autoLockMinutes: number;
	lockOnHide: boolean;
	/** 0 = never */
	clipboardClearSeconds: number;
	backupIntervalMinutes: number;
	backupKeep: number;
	/** 0 = keep forever */
	trashDays: number;
	generator: GeneratorOptions;
}

export const DEFAULT_SETTINGS: PassovikSettings = {
	language: 'ru',
	folder: 'Passovik',
	autoLockMinutes: 15,
	lockOnHide: false,
	clipboardClearSeconds: 30,
	backupIntervalMinutes: 60,
	backupKeep: 20,
	trashDays: 30,
	generator: { ...DEFAULT_GENERATOR_OPTIONS },
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
	typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** Builds settings from stored data, ignoring unknown keys and invalid values. */
export function parseSettings(raw: unknown): PassovikSettings {
	const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
	const d = DEFAULT_SETTINGS;
	const generator = (typeof data.generator === 'object' && data.generator !== null ? data.generator : {}) as Record<
		string,
		unknown
	>;
	const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

	return {
		language: data.language === 'auto' || data.language === 'en' || data.language === 'ru' ? data.language : d.language,
		folder: typeof data.folder === 'string' && data.folder.trim() ? data.folder.trim() : d.folder,
		autoLockMinutes: clampInt(data.autoLockMinutes, 0, 1440, d.autoLockMinutes),
		lockOnHide: bool(data.lockOnHide, d.lockOnHide),
		clipboardClearSeconds: clampInt(data.clipboardClearSeconds, 0, 600, d.clipboardClearSeconds),
		backupIntervalMinutes: clampInt(data.backupIntervalMinutes, 5, 10080, d.backupIntervalMinutes),
		backupKeep: clampInt(data.backupKeep, 0, 200, d.backupKeep),
		trashDays: clampInt(data.trashDays, 0, 3650, d.trashDays),
		generator: {
			length: clampInt(generator.length, 8, 64, d.generator.length),
			lowercase: bool(generator.lowercase, d.generator.lowercase),
			uppercase: bool(generator.uppercase, d.generator.uppercase),
			digits: bool(generator.digits, d.generator.digits),
			symbols: bool(generator.symbols, d.generator.symbols),
			avoidAmbiguous: bool(generator.avoidAmbiguous, d.generator.avoidAmbiguous),
		},
	};
}
