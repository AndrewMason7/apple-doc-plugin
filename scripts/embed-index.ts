/**
 * embed-index — build the symbol layer of the semantic index with a local
 * embedding model (EmbeddingGemma GGUF) or any configured provider.
 *
 * `build:index` only ever embedded framework overviews and media previews, so
 * the vector store never reached the hybrid-search threshold. This script
 * embeds actual symbols, which is what `semantic_search` needs.
 *
 *   npm run embed-index                       # primary types + documented symbols
 *   npm run embed-index -- --enrich           # fetch missing abstracts first
 *   npm run embed-index -- --enrich --enrich-scope members   # document members too
 *   npm run embed-index -- --limit 25         # smoke test
 *   npm run embed-index -- --all               # every symbol (slow)
 *   npm run embed-index -- --all --limit 5000  # exhaustive but bounded
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { AppleDocsDB } from '../src/server/db/database.js';
import { resolveEmbeddingProvider } from '../src/server/services/search/provider-factory.js';
import {
	embedSymbols,
	selectEmbeddingCandidates,
} from '../src/server/services/symbol-embeddings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(flag);
const flagValue = (flag: string): number | undefined => {
	const index = args.indexOf(flag);
	if (index === -1) return undefined;
	const raw = Number(args[index + 1]);
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : undefined;
};

const ALL = hasFlag('--all');
const ENRICH = hasFlag('--enrich');
const LIMIT = flagValue('--limit');
/** Which rows the --enrich pass walks: default selection, or member symbols. */
const ENRICH_SCOPE = args.includes('--enrich-scope')
	? (args[args.indexOf('--enrich-scope') + 1] ?? 'candidates')
	: 'candidates';
const BATCH = flagValue('--batch') ?? 250;

const CONCURRENCY = 6;
const DOC_BASE = 'https://developer.apple.com/tutorials/data';
const CACHE_DIR = join(__dirname, '../.cache/abstracts');

const headers = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
	referer: 'https://developer.apple.com/documentation',
};

const extractAbstract = (abstract: unknown): string => {
	if (!abstract) return '';
	if (typeof abstract === 'string') return abstract.replace(/\s+/g, ' ').trim();
	if (!Array.isArray(abstract)) return '';
	return abstract
		.map((part: any) => {
			if (typeof part === 'string') return part;
			if (part && typeof part === 'object' && 'text' in part) return part.text;
			return '';
		})
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
};

const fetchAbstract = async (path: string): Promise<string | undefined> => {
	const cacheFile = join(
		CACHE_DIR,
		`${path.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)}.json`,
	);
	if (existsSync(cacheFile)) {
		try {
			const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as {
				abstract?: string;
			};
			return cached.abstract ?? '';
		} catch {
			// advisory cache only
		}
	}

	for (const url of [`${DOC_BASE}${path}.json`, `${DOC_BASE}${encodeURI(path)}.json`]) {
		try {
			const res = await axios.get(url, { headers, timeout: 15000 });
			const abstract = extractAbstract(res.data?.abstract);
			mkdirSync(CACHE_DIR, { recursive: true });
			writeFileSync(cacheFile, JSON.stringify({ abstract }), 'utf8');
			return abstract;
		} catch {
			// try the next URL shape
		}
	}
	return undefined;
};

const mapWithConcurrency = async <T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> => {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (cursor < items.length) {
				const index = cursor++;
				results[index] = await fn(items[index]);
			}
		},
	);
	await Promise.all(workers);
	return results;
};

async function enrichAbstracts(db: AppleDocsDB): Promise<void> {
	const candidates =
		ENRICH_SCOPE === 'members'
			? db.getMemberSymbolsForEnrichment()
			: selectEmbeddingCandidates(db, { all: ALL });
	const missing = candidates.filter((candidate) => !candidate.abstract.trim());

	if (LIMIT) missing.splice(LIMIT);
	if (missing.length === 0) {
		console.error('📝 Abstracts: nothing missing.');
		return;
	}

	console.error(
		`📝 Abstracts: fetching ${missing.length} missing abstract(s) from Apple DocC (scope: ${ENRICH_SCOPE})...`,
	);

	let filled = 0;
	let done = 0;

	await mapWithConcurrency(missing, CONCURRENCY, async (candidate) => {
		const abstract = await fetchAbstract(candidate.path);
		done++;
		if (abstract && abstract.trim()) {
			db.updateSymbolAbstract(candidate.id, abstract.trim());
			filled++;
		}
		if (done % 250 === 0) {
			console.error(`   • ${done}/${missing.length} fetched (${filled} filled)`);
		}
	});

	console.error(`📝 Abstracts: filled ${filled} of ${missing.length}.`);
}

async function main(): Promise<void> {
	const envFile = join(__dirname, '../.env');
	if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
		try {
			process.loadEnvFile(envFile);
		} catch {
			// .env is optional
		}
	}

	const dbPath = join(__dirname, '../data/apple-docs.db');
	if (!existsSync(dbPath)) {
		console.error(`✖ No index at ${dbPath}. Run "npm run build:index" first.`);
		process.exit(1);
	}

	const db = new AppleDocsDB(dbPath);
	const provider = resolveEmbeddingProvider();

	console.error(
		`🔎 Provider: ${provider.id} (${provider.dimensions}-d)${provider.isAvailable() ? '' : ' — UNAVAILABLE'}`,
	);
	if (!provider.isAvailable()) {
		console.error(
			'✖ No embedding provider. Set APPLE_DOCS_EMBEDDING_MODEL_PATH to an EmbeddingGemma GGUF file, or place one at ~/.cache/apple-docs/models/embeddinggemma-2-Q8_0.gguf.',
		);
		db.close();
		process.exit(1);
	}

	if (ENRICH) {
		await enrichAbstracts(db);
	}

	const candidates = selectEmbeddingCandidates(db, { all: ALL });
	console.error(
		`\n📚 Candidates: ${candidates.length} symbol(s)${ALL ? ' (all symbols)' : ' (primary types + documented symbols)'}${LIMIT ? `, limited to ${LIMIT}` : ''}`,
	);

	const started = Date.now();
	const result = await embedSymbols(db, provider, {
		all: ALL,
		limit: LIMIT,
		batchSize: BATCH,
		onProgress: ({ done, total, embedded }) => {
			const elapsed = (Date.now() - started) / 1000;
			const rate = done > 0 ? done / elapsed : 0;
			const eta = rate > 0 ? Math.round((total - done) / rate) : 0;
			console.error(
				`   • ${done}/${total} embedded (${rate.toFixed(1)}/s, ~${eta}s left)`,
			);
			void embedded;
		},
	});

	const status = db.getEmbeddingStatus();
	db.setMeta('embedded_at', new Date().toISOString());
	db.setMeta('semantic_item_count', String(status.semanticItemCount));

	console.error(
		`\n✅ Embedded: ${result.embedded} · skipped: ${result.skipped} · failed: ${result.failed}`,
	);
	console.error(
		`📊 Semantic layer: ${status.semanticItemCount}/${status.threshold} items → mode: ${status.mode}`,
	);
	console.error(
		status.hybridEnabled
			? '✨ Hybrid search is now ENABLED (restart the MCP server to pick up the new vectors).'
			: `⚠️ Still below the ${status.threshold}-item threshold; run without --limit to finish.`,
	);

	db.close();
}

main().catch((err) => {
	console.error('Fatal error embedding index:', err);
	process.exit(1);
});
