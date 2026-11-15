/**
 * Apple Developer Documentation Studio — Search & Diagnostics Services
 */

import {
	FALLBACK_STATS,
	FALLBACK_SYMBOLS,
	FALLBACK_IDIOMS,
	LOCAL_MIGRATIONS,
} from '../data/fallbacks.js';

export function localDiagnoseFallback(logText) {
	const findings = [];
	const seen = new Set();
	const re = /'([A-Za-z_][A-Za-z0-9_]*)'/g;
	let m;
	while ((m = re.exec(logText || '')) !== null) {
		const sym = m[1];
		if (!seen.has(sym) && LOCAL_MIGRATIONS[sym]) {
			seen.add(sym);
			findings.push({ symbol: sym, ...LOCAL_MIGRATIONS[sym] });
		}
	}
	return {
		matched: findings.length > 0,
		latencyMs: 1.4,
		findings,
	};
}

export function localSearchFallback(query, framework) {
	const t0 =
		typeof performance !== 'undefined' && performance.now
			? performance.now()
			: Date.now();
	const elapsed = () => {
		const now =
			typeof performance !== 'undefined' && performance.now
				? performance.now()
				: Date.now();
		return Math.max(0, Math.round((now - t0) * 10) / 10);
	};
	const q = (query || '').trim().toLowerCase();
	const pool = framework
		? FALLBACK_SYMBOLS.filter(
				(s) => s.framework.toLowerCase() === framework.toLowerCase(),
			)
		: FALLBACK_SYMBOLS;
	if (!q)
		return {
			results: pool,
			latencyMs: elapsed(),
			mode: 'curated-preview',
			expansion: {},
			offlineFallback: true,
		};

	const matchedIdioms =
		q.length >= 3
			? FALLBACK_IDIOMS.filter((i) => {
					const idiomLower = i.idiom.toLowerCase();
					const firstWord = idiomLower.split(' ')[0];
					return (
						idiomLower.includes(q) ||
						(firstWord.length >= 3 && q.includes(firstWord))
					);
				})
			: [];
	const mappedTokens = matchedIdioms.flatMap((i) =>
		i.appleSymbols.map((s) => s.replace(/^@/, '').split('(')[0].toLowerCase()),
	);
	const filtered = pool.filter((s) => {
		const t = s.title.toLowerCase();
		const a = (s.abstract || '').toLowerCase();
		return (
			t.includes(q.replace(/\*/g, '')) ||
			a.includes(q) ||
			mappedTokens.some((tok) => t.includes(tok))
		);
	});
	// No result-substitution: a zero-match offline search returns an honest empty
	// list so the UI can render "no offline matches" instead of 4 unrelated symbols.
	return {
		results: filtered,
		latencyMs: elapsed(),
		mode: matchedIdioms.length ? 'offline-fallback-idiom' : 'offline-fallback',
		expansion: { matchedIdioms },
		offlineFallback: true,
	};
}

export function safeRest(ctx, endpoint, options) {
	if (ctx && typeof ctx.rest === 'function') {
		return ctx.rest(endpoint, options);
	}
	return Promise.reject(new Error('ctx.rest unavailable'));
}

export async function fetchPluginStatus(ctx) {
	try {
		const res = await safeRest(ctx, '/status');
		if (res && typeof res === 'object' && 'ok' in res) {
			return { stats: res, apiLive: Boolean(res.ok) };
		}
		if (res && res.symbolCount) {
			return { stats: res, apiLive: true };
		}
	} catch {}
	return { stats: FALLBACK_STATS, apiLive: false };
}

export async function fetchPluginIdioms(ctx) {
	try {
		const res = await safeRest(ctx, '/idioms');
		if (res && Array.isArray(res.idioms) && res.idioms.length) {
			return res.idioms;
		}
	} catch {}
	return FALLBACK_IDIOMS;
}

export async function fetchPluginSearch(ctx, { q, framework, mode, limit }) {
	const targetQ = (q || '').trim();
	if (!targetQ && !framework) {
		return {
			data: { results: [], latencyMs: 0, mode: mode || 'semantic' },
			apiLive: false,
		};
	}
	const effectiveQ = targetQ || '*';
	const effectiveMode = targetQ ? mode || 'semantic' : 'lexical';
	const params = new URLSearchParams();
	params.set('q', effectiveQ);
	params.set('mode', effectiveMode);
	params.set('limit', String(limit || 25));
	if (framework) params.set('framework', framework);
	try {
		const res = await safeRest(ctx, `/search?${params.toString()}`);
		if (res && Array.isArray(res.results)) {
			return { data: res, apiLive: true };
		}
	} catch {}
	return { data: localSearchFallback(targetQ, framework), apiLive: false };
}

export async function fetchPluginDoc(ctx, { path, framework }) {
	if (!path) return null;
	const params = new URLSearchParams({ path, live: 'true' });
	if (framework) params.set('framework', framework);
	try {
		const res = await safeRest(ctx, `/doc?${params.toString()}`);
		if (res && res.ok) return res;
	} catch {}
	return null;
}

export async function runPluginDiagnose(ctx, textToAnalyze) {
	try {
		const res = await safeRest(ctx, '/diagnose', {
			method: 'POST',
			body: { command: 'swift build', output: textToAnalyze, returncode: 1 },
		});
		if (res && Array.isArray(res.findings)) {
			return { result: res, apiLive: true };
		}
	} catch {}
	return { result: localDiagnoseFallback(textToAnalyze), apiLive: false };
}
