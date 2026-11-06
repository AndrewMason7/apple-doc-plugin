/**
 * Levenshtein distance and fuzzy matching utilities for symbol typo suggestions.
 */

export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	const aLower = a.toLowerCase();
	const bLower = b.toLowerCase();
	if (aLower === bLower) return 0;

	const lenA = aLower.length;
	const lenB = bLower.length;

	// Optimal string alignment distance (Damerau-Levenshtein) supporting adjacent transpositions
	const d: number[][] = Array.from({ length: lenA + 1 }, () =>
		new Array<number>(lenB + 1).fill(0),
	);

	for (let i = 0; i <= lenA; i++) d[i][0] = i;
	for (let j = 0; j <= lenB; j++) d[0][j] = j;

	for (let i = 1; i <= lenA; i++) {
		const aChar = aLower.charCodeAt(i - 1);
		for (let j = 1; j <= lenB; j++) {
			const bChar = bLower.charCodeAt(j - 1);
			const cost = aChar === bChar ? 0 : 1;
			d[i][j] = Math.min(
				d[i - 1][j] + 1, // deletion
				d[i][j - 1] + 1, // insertion
				d[i - 1][j - 1] + cost, // substitution
			);

			if (
				i > 1 &&
				j > 1 &&
				aLower.charCodeAt(i - 1) === bLower.charCodeAt(j - 2) &&
				aLower.charCodeAt(i - 2) === bLower.charCodeAt(j - 1)
			) {
				d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
			}
		}
	}

	return d[lenA][lenB];
}

export function similarityRatio(a: string, b: string): number {
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1.0;
	const dist = levenshteinDistance(a, b);
	return 1.0 - dist / maxLen;
}
