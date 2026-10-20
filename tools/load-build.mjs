// Writes a CDP snippet that loads the local build (main.js + styles.css) into the running Obsidian
// in memory only: the installed plugin files are not touched, so nothing is synced to other devices.
// usage:
//   node tools/load-build.mjs <out.js>
//   node tools/cdp.mjs eval <out.js>
// tools/snippets/restore.js reloads the installed version from disk afterwards.
import { readFileSync, writeFileSync } from 'node:fs';

const [out] = process.argv.slice(2);
if (!out) throw new Error('usage: node tools/load-build.mjs <out.js>');
const main = readFileSync('main.js', 'utf8');
const styles = readFileSync('styles.css', 'utf8');

writeFileSync(
	out,
	`const files = { 'main.js': ${JSON.stringify(main)}, 'styles.css': ${JSON.stringify(styles)} };
const dir = app.plugins.manifests['passovik'].dir;
const adapter = app.vault.adapter;
const read = adapter.read;
adapter.read = function (path, ...rest) {
	const name = path.startsWith(dir + '/') ? path.slice(dir.length + 1) : null;
	return name && name in files ? Promise.resolve(files[name]) : read.call(this, path, ...rest);
};
try {
	app.plugins.plugins['passovik']?.lock();
	await app.plugins.unloadPlugin('passovik');
	await app.plugins.loadPlugin('passovik');
} finally {
	adapter.read = read;
}
const plugin = app.plugins.plugins['passovik'];
return { loaded: !!plugin, localBuild: typeof plugin?.locateVault === 'function', storePath: plugin?.store.path };
`,
);
