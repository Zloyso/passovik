/**
 * On-disk vault format. Everything except the KDF parameters and IV is encrypted.
 * The header (format, version, salt) is bound to the ciphertext as AES-GCM associated data,
 * so tampering with it makes decryption fail.
 */
import { type KdfParams, seal, unseal } from './crypto';
import { newId, normalizeVault, type VaultData } from './model';

export const VAULT_FORMAT = 'passovik-vault';
export const VAULT_VERSION = 1;

export interface VaultFile {
	format: typeof VAULT_FORMAT;
	version: typeof VAULT_VERSION;
	/** Random id of this write; used to detect changes made on another device. */
	rev: string;
	savedAt: number;
	kdf: KdfParams;
	cipher: { name: 'AES-GCM'; iv: string };
	data: string;
}

export class VaultFormatError extends Error {}

const associatedData = (kdf: KdfParams) => `${VAULT_FORMAT}:${VAULT_VERSION}:${kdf.salt}`;

export function parseVaultFile(text: string): VaultFile {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new VaultFormatError('Vault file is not valid JSON');
	}
	const file = raw as Partial<VaultFile> | null;
	if (!file || file.format !== VAULT_FORMAT) {
		throw new VaultFormatError('Not a vault file');
	}
	if (file.version !== VAULT_VERSION) {
		throw new VaultFormatError(`Unsupported vault version: ${String(file.version)}`);
	}
	const kdf = file.kdf;
	if (
		!kdf ||
		kdf.name !== 'PBKDF2' ||
		kdf.hash !== 'SHA-256' ||
		typeof kdf.iterations !== 'number' ||
		kdf.iterations < 100_000 ||
		typeof kdf.salt !== 'string' ||
		file.cipher?.name !== 'AES-GCM' ||
		typeof file.cipher.iv !== 'string' ||
		typeof file.data !== 'string' ||
		typeof file.rev !== 'string'
	) {
		throw new VaultFormatError('Vault file is damaged');
	}
	return file as VaultFile;
}

export async function encryptVault(key: CryptoKey, kdf: KdfParams, data: VaultData): Promise<VaultFile> {
	const sealed = await seal(key, JSON.stringify(data), associatedData(kdf));
	return {
		format: VAULT_FORMAT,
		version: VAULT_VERSION,
		rev: newId(),
		savedAt: Date.now(),
		kdf,
		cipher: { name: 'AES-GCM', iv: sealed.iv },
		data: sealed.data,
	};
}

/** Throws when the key does not match (wrong password) or the file was modified. */
export async function decryptVault(key: CryptoKey, file: VaultFile): Promise<VaultData> {
	const plain = await unseal(key, { iv: file.cipher.iv, data: file.data }, associatedData(file.kdf));
	return normalizeVault(JSON.parse(plain));
}

export function serializeVaultFile(file: VaultFile): string {
	return JSON.stringify(file, null, 2);
}
