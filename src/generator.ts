/** Password generation and a rough strength estimate. */

export interface GeneratorOptions {
	length: number;
	lowercase: boolean;
	uppercase: boolean;
	digits: boolean;
	symbols: boolean;
	avoidAmbiguous: boolean;
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
	length: 20,
	lowercase: true,
	uppercase: true,
	digits: true,
	symbols: true,
	avoidAmbiguous: true,
};

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 64;

const SETS = {
	lowercase: 'abcdefghijklmnopqrstuvwxyz',
	uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	digits: '0123456789',
	symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
} as const;

const AMBIGUOUS = new Set('Il1O0o|`\'"'.split(''));

/** Uniform random integer in [0, max) using rejection sampling (no modulo bias). */
function randomInt(max: number): number {
	const limit = Math.floor(0x1_0000_0000 / max) * max;
	const buffer = new Uint32Array(1);
	for (;;) {
		crypto.getRandomValues(buffer);
		const value = buffer[0] ?? 0;
		if (value < limit) {
			return value % max;
		}
	}
}

function pick(chars: string): string {
	return chars.charAt(randomInt(chars.length));
}

export function generatePassword(options: GeneratorOptions): string {
	const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(options.length)));
	const filter = (chars: string) =>
		options.avoidAmbiguous ? [...chars].filter((c) => !AMBIGUOUS.has(c)).join('') : chars;

	let classes = (Object.keys(SETS) as (keyof typeof SETS)[])
		.filter((name) => options[name])
		.map((name) => filter(SETS[name]));
	if (!classes.length) {
		classes = [filter(SETS.lowercase)];
	}

	// One character from every selected class, the rest from the combined pool.
	const pool = classes.join('');
	const chars = classes.map(pick);
	while (chars.length < length) {
		chars.push(pick(pool));
	}

	// Fisher–Yates shuffle so the guaranteed characters are not at the start.
	for (let i = chars.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	return chars.join('');
}

export type StrengthScore = 0 | 1 | 2 | 3 | 4;

/** Entropy estimate from character classes and length, with a penalty for repeated characters. */
export function estimateStrength(password: string): { score: StrengthScore; bits: number } {
	if (!password) {
		return { score: 0, bits: 0 };
	}
	let poolSize = 0;
	if (/[a-z]/.test(password)) poolSize += 26;
	if (/[A-Z]/.test(password)) poolSize += 26;
	if (/[0-9]/.test(password)) poolSize += 10;
	if (/[а-яё]/.test(password)) poolSize += 33;
	if (/[А-ЯЁ]/.test(password)) poolSize += 33;
	if (/[^a-zA-Z0-9а-яёА-ЯЁ]/.test(password)) poolSize += 32;

	const unique = new Set(password).size;
	const effectiveLength = Math.min(password.length, unique * 2);
	const bits = Math.round(effectiveLength * Math.log2(Math.max(poolSize, 2)));

	const score: StrengthScore = bits < 36 ? 0 : bits < 50 ? 1 : bits < 65 ? 2 : bits < 85 ? 3 : 4;
	return { score, bits };
}
