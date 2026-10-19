// Run in real Obsidian via: node tools/cdp.mjs eval tools/snippets/use-test-vault.js
// Locks the user's vault (ask the user first!), points the plugin at a throwaway folder and creates a test vault.
// The folder must be visible (the Vault API ignores dot-folders), so Obsidian Sync may briefly sync it.
// Settings are changed in memory only; restore with tools/snippets/restore.js.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, what, timeout = 60000) => {
	const start = Date.now();
	for (;;) {
		const v = fn();
		if (v) return v;
		if (Date.now() - start > timeout) throw new Error('timeout: ' + what);
		await wait(50);
	}
};
const plugin = app.plugins.plugins['passovik'];
const info = { version: app.plugins.manifests['passovik'].version, realWasUnlocked: plugin.store.isUnlocked };
plugin.lock();
plugin.settings.folder = 'passovik-selftest';
if (!app.workspace.getLeavesOfType('passovik-vault').length) await plugin.openVault();
plugin.refreshViews();
const root = () => app.workspace.getLeavesOfType('passovik-vault')[0].view.contentEl;
const inputs = await waitFor(() => {
	const pw = [...root().querySelectorAll('input[type="password"]')];
	return pw.length ? pw : null;
}, 'lock screen');
inputs.forEach((i) => {
	i.value = 'test-master-123';
	i.dispatchEvent(new Event('input', { bubbles: true }));
});
root().querySelector('form').requestSubmit();
await waitFor(() => root().querySelector('.passovik-manager'), 'manager');
info.storePath = plugin.store.path; // must be passovik-selftest/vault.json before taking screenshots
return info;
