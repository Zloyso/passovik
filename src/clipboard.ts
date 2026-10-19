/**
 * Copying with automatic clearing.
 *
 * Desktop: Electron's clipboard can be read in the background, so it is cleared only
 * if it still holds our text. Mobile: the clipboard cannot be inspected reliably
 * (iOS asks for permission), so it is cleared only if Obsidian stayed in the
 * foreground the whole time — otherwise the user may have copied something else.
 */
import { Platform } from 'obsidian';

interface ElectronClipboard {
	readText(): string;
	writeText(text: string): void;
}

let timer: number | null = null;
let leftAppSinceCopy = false;
let visibilityListener: (() => void) | null = null;

function electronClipboard(): ElectronClipboard | null {
	if (!Platform.isDesktopApp) {
		return null;
	}
	try {
		const req = (window as unknown as { require?: (id: string) => unknown }).require;
		const electron = req?.('electron') as { clipboard?: ElectronClipboard } | undefined;
		return electron?.clipboard ?? null;
	} catch {
		return null;
	}
}

function trackVisibility(): void {
	if (visibilityListener) {
		return;
	}
	visibilityListener = () => {
		if (document.visibilityState === 'hidden') {
			leftAppSinceCopy = true;
		}
	};
	document.addEventListener('visibilitychange', visibilityListener);
}

async function clearIfUnchanged(text: string): Promise<void> {
	const native = electronClipboard();
	if (native) {
		if (native.readText() === text) {
			native.writeText('');
		}
		return;
	}
	if (!leftAppSinceCopy && document.visibilityState === 'visible') {
		try {
			await navigator.clipboard.writeText('');
		} catch {
			// Clipboard not writable right now; nothing else to do.
		}
	}
}

export async function copyText(text: string, clearAfterSeconds: number): Promise<void> {
	await navigator.clipboard.writeText(text);
	if (timer !== null) {
		window.clearTimeout(timer);
		timer = null;
	}
	if (clearAfterSeconds <= 0 || !text) {
		return;
	}
	trackVisibility();
	leftAppSinceCopy = false;
	timer = window.setTimeout(() => {
		timer = null;
		void clearIfUnchanged(text);
	}, clearAfterSeconds * 1000);
}

/** Called on plugin unload. Leaves a pending clear in place so secrets do not linger. */
export function disposeClipboard(): void {
	if (visibilityListener) {
		document.removeEventListener('visibilitychange', visibilityListener);
		visibilityListener = null;
	}
}
