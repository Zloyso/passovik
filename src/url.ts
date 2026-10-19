const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HTTP_SCHEME = /^https?:\/\//i;

/**
 * Returns an http(s) URL that is safe to open, or null.
 * Values without a scheme ("example.com") are treated as https; any other scheme is rejected.
 */
export function toSafeUrl(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const candidate = HAS_SCHEME.test(trimmed) && !/^[^:/]+:\d/.test(trimmed) ? trimmed : `https://${trimmed}`;
	if (!HTTP_SCHEME.test(candidate)) {
		return null;
	}
	try {
		const url = new URL(candidate);
		return url.hostname ? url.href : null;
	} catch {
		return null;
	}
}

/** Short label for a URL: its host without "www.", or the raw value if it cannot be parsed. */
export function displayHost(value: string): string {
	const url = toSafeUrl(value);
	if (!url) {
		return value.trim();
	}
	return new URL(url).hostname.replace(/^www\./, '');
}
