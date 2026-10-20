/** Where the vault lives inside the Obsidian vault, and how that changes when folders are moved. */

export const VAULT_FILE = 'vault.json';

/** A usable vault folder: not the root, and no part starts with a dot (sync tools and the Vault API skip those). */
export function isValidFolder(folder: string): boolean {
	return folder !== '' && folder !== '/' && !folder.split('/').some((part) => part === '' || part.startsWith('.'));
}

/** The folder of a vault file at `path`, or null if `path` is not a vault file inside a folder. */
export function vaultFolderOf(path: string): string | null {
	const suffix = `/${VAULT_FILE}`;
	return path.endsWith(suffix) && path.length > suffix.length ? path.slice(0, -suffix.length) : null;
}

/**
 * The vault folder after `oldPath` was renamed to `newPath`: the folder itself, one of its parents,
 * or the vault file was moved. Null when the rename does not concern the vault.
 */
export function movedFolder(folder: string, oldPath: string, newPath: string): string | null {
	if (folder === oldPath || folder.startsWith(`${oldPath}/`)) {
		return newPath + folder.slice(oldPath.length);
	}
	if (oldPath === `${folder}/${VAULT_FILE}`) {
		return vaultFolderOf(newPath);
	}
	return null;
}
