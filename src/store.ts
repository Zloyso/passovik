/**
 * Vault lifecycle: create, unlock, lock, save with merge, backups, password change.
 * While unlocked the store keeps only the derived CryptoKey (never the password) and the decrypted data.
 * All file access goes through Obsidian's Vault API.
 */
import { type App, normalizePath, TFile, TFolder } from 'obsidian';
import { deriveKey, type KdfParams, newKdfParams } from './crypto';
import { emptyVault, mergeVaults, runMaintenance, type VaultData } from './model';
import { isValidFolder, VAULT_FILE, vaultFolderOf } from './location';
import type { PassovikSettings } from './settings';
import { decryptVault, encryptVault, parseVaultFile, serializeVaultFile, type VaultFile } from './vault-file';

const BACKUP_FOLDER = 'backups';
const BACKUP_PREFIX = 'vault-';

export class WrongPasswordError extends Error {}
/** The master password was changed on another device; the local key no longer fits. */
export class KeyChangedError extends Error {}

interface Session {
	key: CryptoKey;
	kdf: KdfParams;
	rev: string;
	data: VaultData;
}

export class VaultStore {
	private session: Session | null = null;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly app: App,
		private readonly getSettings: () => PassovikSettings,
	) {}

	get isUnlocked(): boolean {
		return this.session !== null;
	}

	/** Decrypted data; only valid while unlocked. */
	get data(): VaultData {
		if (!this.session) {
			throw new Error('Vault is locked');
		}
		return this.session.data;
	}

	get folder(): string {
		return normalizePath(this.getSettings().folder);
	}

	get path(): string {
		return normalizePath(`${this.folder}/${VAULT_FILE}`);
	}

	private get vault() {
		return this.app.vault;
	}

	private vaultFile(): TFile | null {
		return this.vault.getFileByPath(this.path);
	}

	async exists(): Promise<boolean> {
		return this.vaultFile() !== null;
	}

	/**
	 * Folders that hold a Passovik vault file, for finding a vault whose folder was moved.
	 * While unlocked only files encrypted with the current key count, so another vault is never picked up.
	 */
	async findVaultFolders(): Promise<string[]> {
		const folders: string[] = [];
		for (const file of this.vault.getFiles()) {
			const folder = vaultFolderOf(file.path);
			if (folder === null || !isValidFolder(folder)) {
				continue;
			}
			let parsed: VaultFile;
			try {
				parsed = parseVaultFile(await this.vault.read(file));
			} catch {
				continue; // Some other file named vault.json.
			}
			if (!this.session || parsed.kdf.salt === this.session.kdf.salt) {
				folders.push(folder);
			}
		}
		return folders.sort((a, b) => a.localeCompare(b));
	}

	private async readFile(): Promise<{ file: VaultFile; text: string } | null> {
		const file = this.vaultFile();
		if (!file) {
			return null;
		}
		const text = await this.vault.read(file);
		return { file: parseVaultFile(text), text };
	}

	private async writeVaultFile(text: string): Promise<void> {
		const existing = this.vaultFile();
		if (existing) {
			await this.vault.modify(existing, text);
		} else {
			await this.ensureFolder(this.folder);
			await this.vault.create(this.path, text);
		}
	}

	async create(password: string): Promise<void> {
		if (await this.exists()) {
			throw new Error('Vault already exists');
		}
		const kdf = newKdfParams();
		const key = await deriveKey(password, kdf);
		const data = emptyVault();
		const file = await encryptVault(key, kdf, data);
		await this.writeVaultFile(serializeVaultFile(file));
		this.session = { key, kdf, rev: file.rev, data };
	}

	async unlock(password: string): Promise<void> {
		const stored = await this.readFile();
		if (!stored) {
			throw new Error('Vault not found');
		}
		const key = await deriveKey(password, stored.file.kdf);
		let data: VaultData;
		try {
			data = await decryptVault(key, stored.file);
		} catch {
			throw new WrongPasswordError();
		}
		this.session = { key, kdf: stored.file.kdf, rev: stored.file.rev, data };
	}

	lock(): void {
		this.session = null;
	}

	/** Applies a change and saves. All writes are serialized. */
	async update(change: (data: VaultData) => void): Promise<void> {
		if (!this.session) {
			throw new Error('Vault is locked');
		}
		change(this.session.data);
		await this.enqueue(() => this.save());
	}

	/**
	 * Picks up a vault file changed by a sync tool. Returns true when data changed.
	 * Throws KeyChangedError when the file was re-encrypted with another password.
	 */
	async reloadFromDisk(): Promise<boolean> {
		let changed = false;
		await this.enqueue(async () => {
			const session = this.session;
			const stored = await this.readFile();
			if (!session || !stored || stored.file.rev === session.rev) {
				return;
			}
			const remote = await this.decryptRemote(session, stored.file);
			session.data = mergeVaults(session.data, remote);
			session.rev = stored.file.rev;
			changed = true;
		});
		return changed;
	}

	/** Re-encrypts the vault with a new password. Old backups keep the old password. */
	async changePassword(current: string, next: string): Promise<void> {
		await this.enqueue(async () => {
			const session = this.session;
			const stored = await this.readFile();
			if (!session || !stored) {
				throw new Error('Vault is locked');
			}
			const currentKey = await deriveKey(current, stored.file.kdf);
			let remote: VaultData;
			try {
				remote = await decryptVault(currentKey, stored.file);
			} catch {
				throw new WrongPasswordError();
			}
			const data = mergeVaults(session.data, remote);
			const kdf = newKdfParams();
			const key = await deriveKey(next, kdf);
			await this.backup(stored.text, true);
			const file = await encryptVault(key, kdf, data);
			await this.writeVaultFile(serializeVaultFile(file));
			this.session = { key, kdf, rev: file.rev, data };
		});
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		const run = this.writeQueue.then(task);
		this.writeQueue = run.catch(() => undefined);
		return run;
	}

	private async decryptRemote(session: Session, file: VaultFile): Promise<VaultData> {
		if (file.kdf.salt !== session.kdf.salt || file.kdf.iterations !== session.kdf.iterations) {
			throw new KeyChangedError();
		}
		try {
			return await decryptVault(session.key, file);
		} catch {
			throw new KeyChangedError();
		}
	}

	private async save(): Promise<void> {
		const session = this.session;
		if (!session) {
			return;
		}
		const stored = await this.readFile();
		if (stored && stored.file.rev !== session.rev) {
			// Changed elsewhere since we loaded it: merge instead of overwriting.
			const remote = await this.decryptRemote(session, stored.file);
			session.data = mergeVaults(session.data, remote);
		}
		runMaintenance(session.data, this.getSettings().trashDays);

		if (stored) {
			await this.backup(stored.text, false);
		}
		const file = await encryptVault(session.key, session.kdf, session.data);
		await this.writeVaultFile(serializeVaultFile(file));
		session.rev = file.rev;
	}

	private get backupFolder(): string {
		return normalizePath(`${this.folder}/${BACKUP_FOLDER}`);
	}

	/** Keeps an encrypted copy of the previous file when the backup interval has passed. */
	private async backup(previousText: string, force: boolean): Promise<void> {
		const { backupKeep, backupIntervalMinutes } = this.getSettings();
		if (backupKeep <= 0) {
			return;
		}
		const existing = this.listBackups();
		const newest = existing[existing.length - 1];
		if (!force && newest && Date.now() - newest.stat.mtime < backupIntervalMinutes * 60_000) {
			return;
		}
		await this.ensureFolder(this.backupFolder);
		// e.g. vault-20261019-185856-123.json; milliseconds and a counter keep quick successive backups apart.
		const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').slice(0, 19);
		let path = normalizePath(`${this.backupFolder}/${BACKUP_PREFIX}${stamp}.json`);
		for (let n = 2; this.vault.getAbstractFileByPath(path); n++) {
			path = normalizePath(`${this.backupFolder}/${BACKUP_PREFIX}${stamp}-${n}.json`);
		}
		await this.vault.create(path, previousText);

		const all = this.listBackups();
		for (const old of all.slice(0, Math.max(0, all.length - backupKeep))) {
			// Respects the user's "deleted files" preference (system trash, .trash or permanent).
			await this.app.fileManager.trashFile(old);
		}
	}

	/** Backup files sorted from oldest to newest (names carry a sortable timestamp). */
	private listBackups(): TFile[] {
		const folder = this.vault.getFolderByPath(this.backupFolder);
		if (!folder) {
			return [];
		}
		return folder.children
			.filter((child): child is TFile => child instanceof TFile)
			.filter((file) => file.name.startsWith(BACKUP_PREFIX) && file.extension === 'json')
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	private async ensureFolder(path: string): Promise<void> {
		const parts = path.split('/');
		for (let i = 1; i <= parts.length; i++) {
			const partial = parts.slice(0, i).join('/');
			if (!partial) {
				continue;
			}
			const existing = this.vault.getAbstractFileByPath(partial);
			if (existing instanceof TFolder) {
				continue;
			}
			if (existing) {
				throw new Error(`"${partial}" is a file, not a folder`);
			}
			await this.vault.createFolder(partial);
		}
	}
}
