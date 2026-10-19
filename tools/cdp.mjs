// Minimal Chrome DevTools Protocol client for the running Obsidian window.
// usage:
//   node cdp.mjs logs                 -> buffered console messages and exceptions
//   node cdp.mjs eval <file.js>       -> evaluate file contents (async allowed), print JSON result
//   node cdp.mjs shot <out.png>       -> screenshot of the window
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, arg] = process.argv.slice(2);
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('app://obsidian.md'));
if (!page) throw new Error('Obsidian page not found');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.onopen = resolve;
	ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();
const events = [];
ws.onmessage = (msg) => {
	const data = JSON.parse(msg.data);
	if (data.id && pending.has(data.id)) {
		pending.get(data.id)(data);
		pending.delete(data.id);
	} else if (data.method) {
		events.push(data);
	}
};
const send = (method, params = {}) =>
	new Promise((resolve) => {
		const id = nextId++;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});

if (mode === 'logs') {
	await send('Runtime.enable');
	await send('Log.enable');
	await new Promise((r) => setTimeout(r, 1500));
	for (const e of events) {
		if (e.method === 'Runtime.consoleAPICalled') {
			const text = e.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
			console.log(`[console.${e.params.type}] ${text}`);
		} else if (e.method === 'Runtime.exceptionThrown') {
			const d = e.params.exceptionDetails;
			console.log(`[exception] ${d.exception?.description ?? d.text}`);
		} else if (e.method === 'Log.entryAdded') {
			console.log(`[log.${e.params.entry.level}] ${e.params.entry.text}`);
		}
	}
} else if (mode === 'eval') {
	const expression = `(async () => { ${readFileSync(arg, 'utf8')} })()`;
	const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
	if (res.result?.exceptionDetails) {
		console.log('EXCEPTION:', res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text);
	} else {
		console.log(JSON.stringify(res.result?.result?.value, null, 2));
	}
} else if (mode === 'shot') {
	const res = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(arg, Buffer.from(res.result.data, 'base64'));
	console.log('saved', arg);
}
ws.close();
