const plugin = app.plugins.plugins['passovik'];
const leaf = app.workspace.getLeavesOfType('passovik-vault')[0];
return {
	version: app.plugins.manifests['passovik']?.version,
	loaded: !!plugin,
	layoutReady: app.workspace.layoutReady,
	storePath: plugin?.store.path,
	unlocked: plugin?.store.isUnlocked,
	vaultFileIndexed: !!app.vault.getFileByPath(plugin?.store.path ?? ''),
	backupsIndexed: app.vault.getFolderByPath('Passovik/backups')?.children.length ?? 0,
	// Only the lock-screen wording, no vault contents.
	lockScreen: plugin?.store.isUnlocked ? '(unlocked - not reading)' : leaf?.view?.contentEl?.querySelector('.passovik-lock-card p')?.textContent,
	submitButton: plugin?.store.isUnlocked ? null : leaf?.view?.contentEl?.querySelector('button[type="submit"]')?.textContent,
};
