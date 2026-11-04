/**
 * repair-index — fix the two classification defects in an existing snapshot
 * without paying for a full `build:index` re-crawl.
 *
 *   1. Framework attribution: re-attribute any row whose `framework` column
 *      contradicts the framework segment of its own path.
 *   2. Symbol kinds: rows stored with the generic `symbol`/`unknown` kind are
 *      re-fetched from the Apple DocC CDN and their authoritative
 *      `metadata.symbolKind` / `metadata.roleHeading` is written back.
 *
 * Dry run by default; pass --apply to write. Always rebuilds the FTS index and
 * records a `repaired_at` stamp when applying.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { AppleDocsDB } from '../src/server/db/database.js';
import {
	canonicalFrameworkFromSlug,
	frameworkSlugFromPath,
} from '../src/server/db/path-attribution.js';
import {
	isPrimaryTypeKind,
	resolveSymbolKind,
} from '../src/server/services/indexer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const APPLY = process.argv.includes('--apply');
const CONCURRENCY = 6;
const DOC_BASE = 'https://developer.apple.com/tutorials/data';
const CACHE_DIR = join(__dirname, '../.cache/repair');

const headers = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
	referer: 'https://developer.apple.com/documentation',
};

interface RepairRow {
	id: string;
	path: string;
	framework: string;
	kind: string;
	title: string;
}

interface DocMetadata {
	symbolKind?: string;
	roleHeading?: string;
	role?: string;
	title?: string;
}

const fetchDocMetadata = async (
	path: string,
): Promise<DocMetadata | undefined> => {
	const cacheFile = join(
		CACHE_DIR,
		`${path.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)}.json`,
	);

	if (existsSync(cacheFile)) {
		try {
			return JSON.parse(readFileSync(cacheFile, 'utf8')) as DocMetadata;
		} catch {
			// Cache is advisory only; fall through to the network.
		}
	}

	const candidates = [`${DOC_BASE}${path}.json`, `${DOC_BASE}${encodeURI(path)}.json`];

	for (const url of candidates) {
		try {
			const res = await axios.get(url, { headers, timeout: 15000 });
			const metadata: DocMetadata = res.data?.metadata ?? {};
			const payload: DocMetadata = {
				symbolKind: metadata.symbolKind,
				roleHeading: metadata.roleHeading,
				role: metadata.role,
				title: metadata.title,
			};
			mkdirSync(CACHE_DIR, { recursive: true });
			writeFileSync(cacheFile, JSON.stringify(payload), 'utf8');
			return payload;
		} catch (err) {
			const status = (err as { response?: { status?: number } }).response
				?.status;
			if (status && status !== 404) {
				console.warn(
					`   ⚠ ${path}: HTTP ${status} (${err instanceof Error ? err.message : String(err)})`,
				);
			}
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

	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			results[index] = await fn(items[index]);
		}
	});

	await Promise.all(workers);
	return results;
};

async function repairIndex() {
	const dbPath = join(__dirname, '../data/apple-docs.db');
	if (!existsSync(dbPath)) {
		console.error(`✖ No index found at ${dbPath}. Run "npm run build:index" first.`);
		process.exit(1);
	}

	const db = new AppleDocsDB(dbPath);
	console.error(
		`${APPLY ? '🔧 Repairing' : '🔍 Dry run of'} ${dbPath} (${db.getSymbolCount()} symbols)\n`,
	);

	// --- 1. Framework attribution ------------------------------------------
	const rows = db.getFrameworkAttributionCandidates() as RepairRow[];

	let reattributed = 0;
	const reattributionSamples: string[] = [];

	for (const row of rows) {
		const expected = canonicalFrameworkFromSlug(frameworkSlugFromPath(row.path));
		if (!expected) continue;
		if (expected.toLowerCase() === row.framework.toLowerCase()) continue;

		reattributed++;
		if (reattributionSamples.length < 8) {
			reattributionSamples.push(
				`${row.title}: ${row.framework} → ${expected} (${row.path})`,
			);
		}
		if (APPLY) db.updateSymbolFramework(row.id, expected);
	}

	console.error(
		`📦 Framework attribution: ${reattributed} row(s) contradict their own path`,
	);
	for (const sample of reattributionSamples) console.error(`   • ${sample}`);

	// --- 2. Symbol kinds ----------------------------------------------------
	const unclassified = db.getUnclassifiedSymbols() as RepairRow[];

	console.error(
		`\n🏷️  Symbol kinds: ${unclassified.length} row(s) carry no classified kind`,
	);

	let resolved = 0;
	let unresolved = 0;
	const kindSamples: string[] = [];

	await mapWithConcurrency(unclassified, CONCURRENCY, async (row) => {
		const metadata = await fetchDocMetadata(row.path);
		if (!metadata) {
			unresolved++;
			return;
		}

		const kind = resolveSymbolKind({
			symbolKind: metadata.symbolKind,
			roleHeading: metadata.roleHeading,
			kind: metadata.role === 'collection' ? 'collection' : undefined,
		});

		if (kind === 'unknown') {
			unresolved++;
			return;
		}

		resolved++;
		if (kindSamples.length < 8) {
			kindSamples.push(`${row.title}: symbol → ${kind}`);
		}
		if (APPLY) db.updateSymbolKind(row.id, kind, isPrimaryTypeKind(kind));
	});

	console.error(`   • resolved: ${resolved}`);
	console.error(`   • still unclassified (no DocC authority): ${unresolved}`);
	for (const sample of kindSamples) console.error(`   • ${sample}`);

	// --- 3. Persist ---------------------------------------------------------
	if (!APPLY) {
		console.error(
			`\n🔍 Dry run complete. Re-run with --apply to write ${reattributed + resolved} change(s).`,
		);
		db.close();
		return;
	}

	console.error('\n🔧 Rebuilding FTS5 index...');
	db.rebuildFTS();
	db.setMeta('repaired_at', new Date().toISOString());
	db.setMeta('symbol_count', String(db.getSymbolCount()));

	console.error(
		`\n✅ Repair complete — ${reattributed} framework fix(es), ${resolved} kind fix(es).`,
	);
	console.error(
		`   Remaining unclassified: ${db.countUnknownKind()}; framework mismatches: ${db.countFrameworkPathMismatches()}`,
	);
	db.close();
}

repairIndex().catch((err) => {
	console.error('Fatal error repairing index:', err);
	process.exit(1);
});
