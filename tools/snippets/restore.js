const plugin = app.plugins.plugins['passovik'];
plugin.lock();
await app.plugins.unloadPlugin('passovik');
await app.plugins.loadPlugin('passovik');
const fresh = app.plugins.plugins['passovik'];
fresh.refreshViews();
await new Promise((r) => setTimeout(r, 500));
const a = app.vault.adapter;
return {
	folder: fresh.settings.folder,
	storePath: fresh.store.path,
	unlocked: fresh.store.isUnlocked,
	pluginDataJson: await a.exists(app.vault.configDir + '/plugins/passovik/data.json'),
	viewText: app.workspace.getLeavesOfType('passovik-vault')[0]?.view.contentEl.innerText.slice(0, 120),
};
