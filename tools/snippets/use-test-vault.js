// Run in real Obsidian via: node tools/cdp.mjs eval tools/snippets/use-test-vault.js
// Locks the user's vault (ask the user first!), points the plugin at a throwaway folder and creates a test vault.
// The folder must be visible (the Vault API ignores dot-folders), so Obsidian Sync may briefly sync it.
// Settings are changed in memory only (saving them is disabled until restore); restore with tools/snippets/restore.js.
const TEST_FOLDER = 'passovik-selftest';
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
// Never write the user's data.json from a test run.
plugin.saveSettings = async () => {};
// Picked by hand: the plugin must not switch back to the user's vault when it finds no file here (1.4.0+).
plugin.chosenFolder = TEST_FOLDER;
plugin.settings.folder = TEST_FOLDER;
// Reveals the tab, which also loads it if Obsidian deferred it at startup.
await plugin.openVault();
plugin.refreshViews();
const root = () => app.workspace.getLeavesOfType('passovik-vault')[0].view.contentEl;
// The "Create vault" screen has two password fields; the unlock screen has one.
const inputs = await waitFor(() => {
	const pw = [...root().querySelectorAll('input[type="password"]')];
	return pw.length === 2 ? pw : null;
}, 'create screen');
if (plugin.store.path !== `${TEST_FOLDER}/vault.json`) {
	throw new Error(`refusing to type the test password: plugin points at ${plugin.store.path}`);
}
inputs.forEach((i) => {
	i.value = 'test-master-123';
	i.dispatchEvent(new Event('input', { bubbles: true }));
});
root().querySelector('form').requestSubmit();
await waitFor(() => root().querySelector('.passovik-manager'), 'manager');
info.storePath = plugin.store.path; // must be passovik-selftest/vault.json before taking screenshots
return info;
