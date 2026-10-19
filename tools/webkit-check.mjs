// Loads Passovik's main.js in WebKit (JavaScriptCore, as on iOS) with a mobile-flavoured Obsidian stub.
// One-time setup (outside the repo deps): npm i --no-save playwright@1.49.1 && npx playwright install webkit
// usage:
//   npx esbuild tests/obsidian-stub.ts --bundle --format=iife --global-name=ObsidianStub --target=safari14 --outfile=<tmp>/stub.js
//   node tools/webkit-check.mjs main.js <tmp>/stub.js
// Expected steps: main.js evaluated, onload ok, view opened, vault created + unlocked, narrow layout: true, entry saved.
// "ResizeObserver loop completed with undelivered notifications" is a benign WebKit notice.
import { readFileSync } from 'node:fs';
import { webkit } from 'playwright';

const [mainPath, stubPath] = process.argv.slice(2);
const mainJs = readFileSync(mainPath, 'utf8');
const stubJs = readFileSync(stubPath, 'utf8');

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: false });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

// Serve from an https origin so crypto.subtle is available (secure context), like the iOS app.
await page.route('https://passovik.test/**', (route) =>
	route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body class="is-mobile"></body></html>' }),
);
await page.goto('https://passovik.test/');
await page.addScriptTag({ content: stubJs });

const result = await page.evaluate(async (source) => {
	const O = window.ObsidianStub;
	Object.assign(O.Platform, { isDesktopApp: false, isMobile: true, isMobileApp: true, isPhone: true, isIosApp: true });

	const files = new Map();
	const adapter = {
		exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + '/')),
		read: async (p) => {
			if (!files.has(p)) throw new Error('ENOENT ' + p);
			return files.get(p);
		},
		write: async (p, t) => void files.set(p, t),
		mkdir: async () => {},
		list: async (p) => ({ files: [...files.keys()].filter((k) => k.slice(0, k.lastIndexOf('/')) === p), folders: [] }),
		remove: async (p) => void files.delete(p),
		stat: async () => ({ mtime: Date.now() }),
	};
	const views = {};
	const leaves = [];
	const dirs = new Set();
	const toFile = (p) => {
		const f = new O.TFile(p, p.split('.').pop());
		f.stat.mtime = Date.now();
		return f;
	};
	const parentOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
	const vault = {
		adapter,
		on: () => ({}),
		getFiles: () => [...files.keys()].map(toFile),
		getFileByPath: (p) => (files.has(p) ? toFile(p) : null),
		getFolderByPath: (p) => (dirs.has(p) ? new O.TFolder(p, [...files.keys()].filter((f) => parentOf(f) === p).map(toFile)) : null),
		getAbstractFileByPath: (p) => (files.has(p) ? toFile(p) : dirs.has(p) ? new O.TFolder(p) : null),
		read: async (f) => files.get(f.path),
		modify: async (f, t) => void files.set(f.path, t),
		create: async (p, t) => {
			if (parentOf(p) && !dirs.has(parentOf(p))) throw new Error('no folder ' + p);
			files.set(p, t);
			return toFile(p);
		},
		createFolder: async (p) => void dirs.add(p),
		delete: async (f) => void files.delete(f.path),
	};
	const app = {
		vault,
		workspace: {
			layoutReady: true,
			onLayoutReady: (cb) => cb(),
			getLeavesOfType: (t) => leaves.filter((l) => l.type === t),
			getLeaf: () => {
				const leaf = { app, type: null, view: null };
				leaf.setViewState = async ({ type }) => {
					leaf.type = type;
					leaf.view = views[type](leaf);
					document.body.appendChild(leaf.view.contentEl);
					leaves.push(leaf);
					await leaf.view.onOpen();
				};
				return leaf;
			},
			revealLeaf: async () => {},
		},
		fileManager: { trashFile: async () => {} },
	};
	class Plugin {
		constructor(a, manifest) {
			this.app = a;
			this.manifest = manifest;
		}
		async loadData() {
			return { language: 'ru' };
		}
		async saveData() {}
		registerView(type, factory) {
			views[type] = factory;
		}
		addRibbonIcon() {}
		addCommand() {}
		addSettingTab() {}
		registerInterval(id) {
			return id;
		}
		registerDomEvent(el, type, cb) {
			el.addEventListener(type, cb);
		}
		registerEvent() {}
	}
	const obsidian = { ...O, Plugin };

	const steps = [];
	try {
		const module = { exports: {} };
		new Function('module', 'exports', 'require', source)(module, module.exports, (id) => {
			if (id === 'obsidian') return obsidian;
			throw new Error('unexpected require: ' + id);
		});
		steps.push('main.js evaluated');
		const plugin = new module.exports.default(app, { id: 'passovik', version: 'test' });
		await plugin.onload();
		steps.push('onload ok');
		await plugin.openVault();
		steps.push('view opened');

		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const until = async (fn, what) => {
			for (let i = 0; i < 400; i++) {
				if (fn()) return;
				await wait(25);
			}
			throw new Error('timeout: ' + what);
		};
		const root = leaves[0].view.contentEl;
		const pw = [...root.querySelectorAll('input[type="password"]')];
		for (const input of pw) {
			input.value = 'iphone-master-1';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		}
		root.querySelector('button[type="submit"]').click();
		await until(() => root.querySelector('.passovik-manager'), 'manager');
		steps.push('vault created + unlocked (WebCrypto ok)');
		steps.push('narrow layout: ' + root.querySelector('.passovik-manager').classList.contains('is-narrow'));

		root.querySelector('[aria-label="Новая запись"]').click();
		await until(() => root.querySelector('.passovik-editor'), 'editor');
		const form = root.querySelector('.passovik-editor');
		const text = form.querySelectorAll('input[type="text"]');
		text[0].value = 'Почта';
		text[0].dispatchEvent(new Event('input', { bubbles: true }));
		form.querySelector('input[type="url"]').value = 'mail.ru';
		form.querySelector('button[type="submit"]').click();
		await until(() => root.querySelector('.passovik-detail-title')?.textContent === 'Почта', 'entry saved');
		steps.push('entry saved, panes visible: ' + root.querySelectorAll('.passovik-pane').length);
	} catch (e) {
		steps.push('FAILED: ' + (e && e.stack ? e.stack : String(e)));
	}
	return { userAgent: navigator.userAgent, steps };
}, mainJs);

console.log(JSON.stringify(result, null, 2));
if (logs.length) console.log(logs.join('\n'));
await browser.close();
