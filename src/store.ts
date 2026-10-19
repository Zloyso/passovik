/**
 * Vault lifecycle: create, unlock, lock, save with merge, backups, password change.
 * While unlocked the store keeps only the derived CryptoKey (never the password) and the decrypted data.
 */
import { type App, normalizePath } from 'obsidian';
import { deriveKey, type KdfParams, newKdfParams } from './crypto';
import { emptyVault, mergeVaults, runMaintenance, type VaultData } from './model';
import type { PassovikSettings } from './settings';
import { decryptVault, encryptVault, parseVaultFile, serializeVaultFile, type VaultFile } from './vault-file';

const VAULT_FILE = 'vault.json';
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

	private get adapter() {
		return this.app.vault.adapter;
	}

	async exists(): Promise<boolean> {
		return this.adapter.exists(this.path);
	}

	private async readFile(): Promise<{ file: VaultFile; text: string } | null> {
		if (!(await this.exists())) {
			return null;
		}
		const text = await this.adapter.read(this.path);
		return { file: parseVaultFile(text), text };
	}

	async create(password: string): Promise<void> {
		if (await this.exists()) {
			throw new Error('Vault already exists');
		}
		const kdf = newKdfParams();
		const key = await deriveKey(password, kdf);
		const data = emptyVault();
		await this.ensureFolder(this.folder);
		const file = await encryptVault(key, kdf, data);
		await this.adapter.write(this.path, serializeVaultFile(file));
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
			await this.adapter.write(this.path, serializeVaultFile(file));
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
		} else {
			await this.ensureFolder(this.folder);
		}
		const file = await encryptVault(session.key, session.kdf, session.data);
		await this.adapter.write(this.path, serializeVaultFile(file));
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
		await this.ensureFolder(this.backupFolder);
		const existing = await this.listBackups();
		const newest = existing[existing.length - 1];
		if (!force && newest) {
			const stat = await this.adapter.stat(newest);
			if (stat && Date.now() - stat.mtime < backupIntervalMinutes * 60_000) {
				return;
			}
		}
		const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
		await this.adapter.write(normalizePath(`${this.backupFolder}/${BACKUP_PREFIX}${stamp}.json`), previousText);

		const all = await this.listBackups();
		for (const old of all.slice(0, Math.max(0, all.length - backupKeep))) {
			await this.adapter.remove(old);
		}
	}

	private async listBackups(): Promise<string[]> {
		if (!(await this.adapter.exists(this.backupFolder))) {
			return [];
		}
		const { files } = await this.adapter.list(this.backupFolder);
		return files
			.filter((file) => {
				const name = file.split('/').pop() ?? '';
				return name.startsWith(BACKUP_PREFIX) && name.endsWith('.json');
			})
			.sort();
	}

	private async ensureFolder(path: string): Promise<void> {
		const parts = path.split('/');
		for (let i = 1; i <= parts.length; i++) {
			const partial = parts.slice(0, i).join('/');
			if (partial && !(await this.adapter.exists(partial))) {
				await this.adapter.mkdir(partial);
			}
		}
	}
}
