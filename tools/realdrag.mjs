// Real mouse drag in Obsidian through CDP: press on one sidebar group, move, release on another.
// usage: node realdrag.mjs <source group name> <target group name | HEADER>
const [sourceName, targetName] = process.argv.slice(2);
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('app://obsidian.md'));
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
const evaluate = async (expression) =>
	(await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rectOf = (name) => `(() => {
	const root = app.workspace.getLeavesOfType('passovik-vault')[0].view.contentEl;
	const el = ${name === 'HEADER' ? `root.querySelector('.passovik-nav-header')` : name.startsWith('entry:') ? `[...root.querySelectorAll('.passovik-entry')].find((e) => e.querySelector('.passovik-entry-title')?.textContent === ${JSON.stringify(name.slice(6))})` : `[...root.querySelectorAll('.passovik-nav-item')].find((e) => e.querySelector('.passovik-nav-label')?.textContent === ${JSON.stringify(name)})`};
	if (!el) return null;
	const r = (el.querySelector('.passovik-nav-label') ?? el.querySelector('.passovik-entry-title') ?? el).getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

const from = await evaluate(rectOf(sourceName));
const to = await evaluate(rectOf(targetName));
if (!from || !to) throw new Error('element not found');

await send('Input.setInterceptDrags', { enabled: true });
const mouse = (type, p, extra = {}) =>
	send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, ...extra });

await mouse('mouseMoved', from, { buttons: 0, button: 'none' });
await mouse('mousePressed', from, { clickCount: 1 });
for (let i = 1; i <= 10; i++) {
	await mouse('mouseMoved', { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 });
	await sleep(30);
}
await sleep(200);
const intercepted = events.find((e) => e.method === 'Input.dragIntercepted');
let highlighted = null;
if (intercepted) {
	const data = intercepted.params.data;
	await send('Input.dispatchDragEvent', { type: 'dragEnter', x: to.x, y: to.y, data });
	await send('Input.dispatchDragEvent', { type: 'dragOver', x: to.x, y: to.y, data });
	highlighted = await evaluate(`[...app.workspace.getLeavesOfType('passovik-vault')[0].view.contentEl.querySelectorAll('.is-drop-target')].map((e) => e.querySelector('.passovik-nav-label')?.textContent ?? 'HEADER')`);
	await send('Input.dispatchDragEvent', { type: 'drop', x: to.x, y: to.y, data });
}
await mouse('mouseReleased', to, { clickCount: 1 });
await send('Input.setInterceptDrags', { enabled: false });
await sleep(800);

const result = await evaluate(`(() => {
	const s = app.plugins.plugins.passovik.store;
	return { path: s.path, entryGroups: Object.fromEntries(s.data.entries.map((e) => [e.title, e.groupId ? s.data.groups.find((g) => g.id === e.groupId)?.name : null])) };
})()`);
console.log(
	JSON.stringify(
		{ drag: `${sourceName} -> ${targetName}`, dragStarted: !!intercepted, dragTypes: intercepted?.params.data.items.map((i) => i.mimeType), highlightedDuringDragOver: highlighted, ...result },
		null,
		2,
	),
);
ws.close();
