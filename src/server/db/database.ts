import type DatabaseConstructor from 'better-sqlite3';
import type {
	Database as SqliteDatabase,
	Options as SqliteOptions,
} from 'better-sqlite3';
import { createRequire } from 'node:module';
import { closeSync, existsSync, fstatSync, openSync, statSync } from 'node:fs';
import { SCHEMA_SQL } from './schema.js';
import { isVirtualDbPath } from './db-path.js';
import { logger } from '../logger.js';
import {
	canonicalFrameworkFromSlug,
	frameworkSlugFromPath,
} from './path-attribution.js';
import { levenshteinDistance } from '../services/levenshtein.js';

const nodeRequire = createRequire(import.meta.url);
let BetterSqlite3: typeof DatabaseConstructor | null = null;
try {
	BetterSqlite3 = nodeRequire('better-sqlite3');
} catch (err) {
	logger.warn(
		'Failed to load native better-sqlite3 module:',
		err instanceof Error ? err.message : String(err),
	);
}

let sqliteVec: any = null;
try {
	sqliteVec = nodeRequire('sqlite-vec');
} catch (err) {
	logger.debug('sqlite-vec module not available:', err);
}

/**
 * Minimum number of embedded semantic items before the search engine will fuse
 * vector results with FTS5. Below this the server is lexical-only, and every
 * status surface must say so.
 */
export const MIN_SEMANTIC_ITEMS_FOR_HYBRID = 100;

/** Kinds that carry no classification and must never satisfy a kind filter. */
const UNCLASSIFIED_KINDS = ['symbol', 'unknown'] as const;

export interface EmbeddingStatus {
	semanticItemCount: number;
	threshold: number;
	hybridEnabled: boolean;
	mode: 'hybrid' | 'lexical-only';
	/** True when any vectors exist at all (e.g. framework cards, media previews). */
	storageHasVectors: boolean;
}

/**
 * Result of the readability canary. A readable database still needs its own
 * probes; an unreadable one means every other getter is about to lie.
 */
export type DbReadability =
	| { readable: true; schemaVersion: number }
	| { readable: false; error: string };

export interface FreshnessInfo {
	builtAt: string;
	source: 'meta' | 'db-file-mtime' | 'unknown';
}

export interface KindCount {
	kind: string;
	count: number;
}

export interface DbSymbol {
	id: string;
	framework: string;
	title: string;
	kind: string;
	abstract: string;
	path: string;
	platforms: string[];
	isPrimaryType?: boolean;
}

export interface FTSResult extends DbSymbol {
	score: number;
}

export interface SemanticItem {
	id: string;
	framework: string;
	title: string;
	kind: string;
	summary: string;
	path: string;
	mediaUrl?: string;
	mediaType?: string;
	embedding: Float32Array;
	norm?: number;
}

export function deserializeFloat32Array(buf: Buffer): Float32Array | null {
	if (buf.byteLength % 4 !== 0 || buf.byteLength === 0) {
		return null;
	}
	const aligned = new ArrayBuffer(buf.byteLength);
	new Uint8Array(aligned).set(buf);
	return new Float32Array(aligned);
}

function safeParsePlatforms(val: unknown): string[] {
	if (typeof val !== 'string' || !val.trim()) return [];
	try {
		const parsed = JSON.parse(val);
		return Array.isArray(parsed) ? parsed : [];
	} catch (err) {
		logger.debug('Failed to parse platforms JSON:', err);
		return [];
	}
}

export class AppleDocsDB {
	public readonly dbPath: string;
	private db: SqliteDatabase;
	private vectorCache: SemanticItem[] | null = null;
	private hasVec = false;
	private vecDimensions = 768;
	private fd: number | null = null;
	private openedInode: number | null = null;
	private openedDev: number | null = null;
	private openedBuildId: string | null = null;

	constructor(dbPath: string, options: SqliteOptions = {}) {
		if (!BetterSqlite3) {
			throw new Error(
				'better-sqlite3 native binding is not available in this environment',
			);
		}
		this.dbPath = dbPath;
		this.db = new BetterSqlite3(dbPath, options);

		if (!isVirtualDbPath(this.dbPath)) {
			try {
				if (existsSync(this.dbPath)) {
					this.fd = openSync(this.dbPath, 'r');
					const st = fstatSync(this.fd);
					this.openedInode = st.ino;
					this.openedDev = st.dev;
				}
			} catch (err) {
				logger.debug(
					'Failed to open tracking file descriptor for dbPath:',
					err,
				);
				try {
					if (existsSync(this.dbPath)) {
						const st = statSync(this.dbPath);
						this.openedInode = st.ino;
						this.openedDev = st.dev;
					}
				} catch {}
			}
		}

		if (sqliteVec && this.db) {
			try {
				sqliteVec.load(this.db);
				this.hasVec = true;
			} catch (err) {
				logger.debug('Failed to load sqlite-vec extension into database:', err);
				this.hasVec = false;
			}
		}

		if (!options.readonly) {
			this.db.pragma('journal_mode = WAL');
			this.db.exec(SCHEMA_SQL);
			if (this.hasVec) {
				try {
					this.db.exec(`
						CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
							id TEXT PRIMARY KEY,
							embedding FLOAT[768] DISTANCE_METRIC=COSINE
						);
					`);
					this.syncVecIndex();
				} catch (err) {
					logger.debug('Failed to create vec_items virtual table:', err);
				}
			}
			// Safe column migrations for existing databases
			try {
				this.db.exec('ALTER TABLE semantic_items ADD COLUMN media_url TEXT');
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				if (!msg.includes('duplicate column name')) {
					logger.warn('Failed to apply media_url migration:', msg);
				}
			}
			try {
				this.db.exec('ALTER TABLE semantic_items ADD COLUMN media_type TEXT');
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				if (!msg.includes('duplicate column name')) {
					logger.warn('Failed to apply media_type migration:', msg);
				}
			}
		}

		try {
			this.openedBuildId = this.getMeta('built_at') ?? null;
		} catch {}
	}

	/**
	 * Cheap check that the database file has not been deleted or replaced on disk.
	 * Hard-fails with "index was replaced — restart the MCP server" instead of
	 * silently answering from a corpse.
	 *
	 * Two legs, deliberately unequal in importance:
	 *  1. inode + device (primary) — the tracking fd pins the opened inode, so a
	 *     mismatch can only mean the path now resolves to a different file. This
	 *     is the leg that catches the incident this method exists for.
	 *  2. meta build id (secondary) — catches an in-place rebuild that bumps
	 *     `built_at`. See the note on that block for what it does NOT catch.
	 */
	assertNotReplaced(): void {
		if (isVirtualDbPath(this.dbPath) || this.dbPath === '') {
			return;
		}
		if (this.openedInode === null && this.fd === null) {
			return;
		}

		let currentStat: ReturnType<typeof statSync>;
		try {
			currentStat = statSync(this.dbPath);
		} catch {
			// File was deleted or unlinked on disk (e.g. ENOENT)
			throw new Error('index was replaced — restart the MCP server');
		}

		// The open tracking fd pins the original inode, so the kernel can never
		// recycle that number while we hold it: an inode mismatch here always
		// means the path now points at a different file, never at a stale number.
		// A size/fingerprint check is pointless for the same reason and actively
		// harmful — this class writes to its own database (index builds, vector
		// imports, setMeta), so any size snapshot taken at open time goes stale
		// on the first insert and would fail every later read.
		if (this.openedInode !== null && currentStat.ino !== this.openedInode) {
			throw new Error('index was replaced — restart the MCP server');
		}

		if (this.openedDev !== null && currentStat.dev !== this.openedDev) {
			throw new Error('index was replaced — restart the MCP server');
		}

		// Secondary leg only. Do not mistake this for the primary defence, and do
		// not delete the inode comparison above on the strength of it: a replaced
		// index very often carries the *same* snapshot stamp. `download-vectors`
		// appends vectors to the build it already has, so the stale database and
		// the freshly downloaded one both reported built_at
		// 2026-11-08T12:48:31.487Z while differing by 143 MB and 19,473 vectors.
		// This leg earns its place only for an in-place rebuild that bumps the
		// stamp (covered by "throws when DB meta build id changes externally");
		// for replacement-by-rename it is silent, and the inode leg carries it.
		if (this.openedBuildId) {
			try {
				const currentBuildId = this.getMeta('built_at');
				if (currentBuildId && currentBuildId !== this.openedBuildId) {
					throw new Error('index was replaced — restart the MCP server');
				}
			} catch (err) {
				if (
					err instanceof Error &&
					err.message === 'index was replaced — restart the MCP server'
				) {
					throw err;
				}
			}
		}
	}

	/**
	 * Readability canary. better-sqlite3 opens a path lazily: a file that is not
	 * SQLite reports no error at construction time, and every getter below
	 * swallows the failure into 0/[]. One PRAGMA therefore decides whether any
	 * other number this class returns can be believed — without it, a corrupt
	 * index is indistinguishable from an empty one.
	 */
	probeReadability(): DbReadability {
		try {
			const version = this.db.pragma('schema_version', { simple: true });
			return { readable: true, schemaVersion: Number(version) };
		} catch (err) {
			return {
				readable: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	setMeta(key: string, value: string): void {
		this.db
			.prepare(
				`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			)
			.run(key, value);
		if (key === 'built_at') {
			this.openedBuildId = value;
		}
	}

	getMeta(key: string): string | undefined {
		try {
			const row = this.db
				.prepare(`SELECT value FROM meta WHERE key = ?`)
				.get(key) as { value: string } | undefined;
			return row?.value;
		} catch (err) {
			logger.warn(
				`Failed to get meta for key "${key}":`,
				err instanceof Error ? err.message : String(err),
			);
			return undefined;
		}
	}

	getSymbolCount(): number {
		try {
			const row = this.db
				.prepare(`SELECT count(*) as count FROM symbols`)
				.get() as {
				count: number;
			};
			return row?.count ?? 0;
		} catch (err) {
			logger.warn(
				'Failed to get symbol count:',
				err instanceof Error ? err.message : String(err),
			);
			return 0;
		}
	}

	getIndexedFrameworks(): string[] {
		try {
			const rows = this.db
				.prepare(
					`SELECT DISTINCT framework FROM symbols ORDER BY framework ASC`,
				)
				.all() as Array<{ framework: string }>;
			return rows.map((r) => r.framework);
		} catch (err) {
			logger.warn(
				'Failed to get indexed frameworks:',
				err instanceof Error ? err.message : String(err),
			);
			return [];
		}
	}

	getFrameworkSymbolCounts(): Array<{ framework: string; count: number }> {
		try {
			const rows = this.db
				.prepare(
					`SELECT framework, count(*) as count FROM symbols GROUP BY framework ORDER BY count DESC, framework ASC`,
				)
				.all() as Array<{ framework: string; count: number }>;
			return rows;
		} catch (err) {
			logger.warn(
				'Failed to get framework symbol counts:',
				err instanceof Error ? err.message : String(err),
			);
			return [];
		}
	}

	getFrameworkPrimarySymbolCounts(): Array<{
		framework: string;
		count: number;
	}> {
		try {
			const rows = this.db
				.prepare(
					`SELECT framework, count(*) as count FROM symbols WHERE is_primary_type = 1 GROUP BY framework`,
				)
				.all() as Array<{ framework: string; count: number }>;
			return rows;
		} catch (err) {
			logger.warn(
				'Failed to get framework primary symbol counts:',
				err instanceof Error ? err.message : String(err),
			);
			return [];
		}
	}

	/**
	 * Full embedding/search-mode status. The search path needs
	 * MIN_SEMANTIC_ITEMS_FOR_HYBRID vectors before it will fuse semantically, so
	 * reporting "embeddings present" from a raw row count is not the same claim
	 * as "hybrid search is enabled" — keep both facts.
	 */
	getEmbeddingStatus(): EmbeddingStatus {
		// The status tools are what told the operator "lexical only, 0 semantic
		// items" while the live index held 19,473 vectors, so this entry point
		// refuses to describe a database it no longer owns.
		this.assertNotReplaced();
		const semanticItemCount = this.getSemanticItemCount();
		const hybridEnabled = semanticItemCount >= MIN_SEMANTIC_ITEMS_FOR_HYBRID;

		return {
			semanticItemCount,
			threshold: MIN_SEMANTIC_ITEMS_FOR_HYBRID,
			hybridEnabled,
			mode: hybridEnabled ? 'hybrid' : 'lexical-only',
			storageHasVectors: semanticItemCount > 0,
		};
	}

	/** True when *any* vectors exist — not a claim that hybrid search is active. */
	hasEmbeddings(): boolean {
		return this.getEmbeddingStatus().storageHasVectors;
	}

	getKindDistribution(): KindCount[] {
		try {
			const rows = this.db
				.prepare(
					`SELECT kind, count(*) as count FROM symbols GROUP BY kind ORDER BY count DESC`,
				)
				.all() as KindCount[];
			return rows;
		} catch (err) {
			logger.warn(
				'Failed to get kind distribution:',
				err instanceof Error ? err.message : String(err),
			);
			return [];
		}
	}

	/**
	 * Document count of the FTS5 shadow table. `symbols_fts` is an external-content
	 * table (content='symbols'), so a plain `count(*)` there is served from `symbols`
	 * and can never disagree with getSymbolCount(). Only the docsize shadow table
	 * reflects what the index actually holds.
	 */
	getFtsCount(): number {
		try {
			const row = this.db
				.prepare(`SELECT count(*) as count FROM symbols_fts_docsize`)
				.get() as { count: number } | undefined;
			return row?.count ?? 0;
		} catch (err) {
			logger.warn(
				'Failed to count FTS rows:',
				err instanceof Error ? err.message : String(err),
			);
			return 0;
		}
	}

	/**
	 * Distinct vector widths currently stored. More than one value (or a value
	 * that differs from the active provider) means queries cannot be scored
	 * against part of the corpus.
	 */
	getVectorDimensions(): number[] {
		try {
			const rows = this.db
				.prepare(
					`SELECT DISTINCT (LENGTH(embedding) / 4.0) AS dims FROM semantic_items ORDER BY dims ASC`,
				)
				.all() as Array<{ dims: number }>;
			return rows
				.map((row) => row.dims)
				.filter((d) => Number.isFinite(d) && d > 0);
		} catch (err) {
			logger.warn(
				'Failed to read vector dimensions:',
				err instanceof Error ? err.message : String(err),
			);
			return [];
		}
	}

	/**
	 * Width of the stored vectors, in dimensions, from a single row.
	 *
	 * Deliberately cheap: `get_version` is called on every request and a full
	 * `DISTINCT` over 19k blob rows costs ~240 ms on the shipped corpus. This
	 * catches the case that matters — a uniformly old (3072-d) corpus queried at
	 * 768-d — while `getVectorDimensions()` remains the authoritative check for
	 * a mixed store, which doctor runs.
	 */
	getStoredVectorWidth(): number | null {
		try {
			const row = this.db
				.prepare(
					`SELECT LENGTH(embedding) / 4 AS dims FROM semantic_items LIMIT 1`,
				)
				.get() as { dims: number } | undefined;
			return typeof row?.dims === 'number' && row.dims > 0 ? row.dims : null;
		} catch (err) {
			logger.warn(
				'Failed to read the stored vector width:',
				err instanceof Error ? err.message : String(err),
			);
			return null;
		}
	}

	/** Rows stored with a generic `symbol`/`unknown` kind, i.e. unclassified. */
	countUnknownKind(): number {
		try {
			const placeholders = UNCLASSIFIED_KINDS.map(() => '?').join(', ');
			const row = this.db
				.prepare(
					`SELECT count(*) as count FROM symbols WHERE lower(kind) IN (${placeholders})`,
				)
				.get(...UNCLASSIFIED_KINDS) as { count: number } | undefined;
			return row?.count ?? 0;
		} catch (err) {
			logger.warn(
				'Failed to count unclassified symbols:',
				err instanceof Error ? err.message : String(err),
			);
			return 0;
		}
	}

	/**
	 * Rows whose `framework` column contradicts the framework segment of their
	 * own path — the cross-framework false positives that leak through
	 * framework-scoped searches.
	 */
	countFrameworkPathMismatches(): number {
		try {
			const rows = this.db
				.prepare(
					`SELECT framework, path FROM symbols WHERE path LIKE '/documentation/%'`,
				)
				.all() as Array<{ framework: string; path: string }>;

			let mismatches = 0;
			for (const row of rows) {
				const expected = canonicalFrameworkFromSlug(
					frameworkSlugFromPath(row.path),
				);
				if (!expected) continue;
				if (expected.toLowerCase() !== row.framework.toLowerCase()) {
					mismatches++;
				}
			}
			return mismatches;
		} catch (err) {
			logger.warn(
				'Failed to count framework/path mismatches:',
				err instanceof Error ? err.message : String(err),
			);
			return 0;
		}
	}

	/**
	 * Snapshot freshness. Falls back to the database file mtime and names that
	 * provenance, so a derived timestamp is never mistaken for a build stamp.
	 */
	getFreshness(): FreshnessInfo {
		const recorded = this.getMeta('built_at');
		if (recorded && recorded.trim()) {
			return { builtAt: recorded.trim(), source: 'meta' };
		}

		try {
			const stats = statSync(this.dbPath);
			return {
				builtAt: new Date(stats.mtimeMs).toISOString(),
				source: 'db-file-mtime',
			};
		} catch (err) {
			logger.debug(
				'Failed to stat database for freshness:',
				err instanceof Error ? err.message : String(err),
			);
			return { builtAt: 'unknown', source: 'unknown' };
		}
	}

	updateSymbolKind(id: string, kind: string, isPrimaryType?: boolean): void {
		const primary = isPrimaryType ? 1 : 0;
		this.db
			.prepare(`UPDATE symbols SET kind = ?, is_primary_type = ? WHERE id = ?`)
			.run(kind, primary, id);
	}

	updateSymbolFramework(id: string, framework: string): void {
		this.db
			.prepare(`UPDATE symbols SET framework = ? WHERE id = ?`)
			.run(framework, id);
	}

	/** Rows whose framework attribution can be checked against their path. */
	getFrameworkAttributionCandidates(): Array<{
		id: string;
		path: string;
		framework: string;
		title: string;
	}> {
		return this.db
			.prepare(
				`SELECT id, path, framework, title FROM symbols WHERE path LIKE '/documentation/%'`,
			)
			.all() as Array<{
			id: string;
			path: string;
			framework: string;
			title: string;
		}>;
	}

	/**
	 * Default embedding selection: primary types plus anything Apple documented.
	 * Documented symbols sort first so a limited run spends its budget on the
	 * rows that carry real meaning.
	 */
	getEmbeddingCandidateSymbols(): Array<{
		id: string;
		title: string;
		kind: string;
		framework: string;
		abstract: string;
		path: string;
	}> {
		return this.db
			.prepare(
				`SELECT id, title, kind, framework, COALESCE(abstract, '') AS abstract, path
         FROM symbols
         WHERE is_primary_type = 1
            OR lower(kind) IN ('struct', 'class', 'protocol', 'enum', 'macro', 'union')
            OR (abstract IS NOT NULL AND abstract != '')
         ORDER BY is_primary_type DESC,
                  (CASE WHEN abstract IS NOT NULL AND abstract != '' THEN 0 ELSE 1 END) ASC,
                  title ASC`,
			)
			.all() as Array<{
			id: string;
			title: string;
			kind: string;
			framework: string;
			abstract: string;
			path: string;
		}>;
	}

	/** Every symbol, for an exhaustive embedding pass. */
	getAllSymbolsForEmbedding(): Array<{
		id: string;
		title: string;
		kind: string;
		framework: string;
		abstract: string;
		path: string;
	}> {
		return this.db
			.prepare(
				`SELECT id, title, kind, framework, COALESCE(abstract, '') AS abstract, path
         FROM symbols
         ORDER BY is_primary_type DESC, title ASC`,
			)
			.all() as Array<{
			id: string;
			title: string;
			kind: string;
			framework: string;
			abstract: string;
			path: string;
		}>;
	}

	/**
	 * Members (methods, properties, initializers…) of the frameworks people
	 * actually reach for, that still have no abstract. Cheap ingestion only ever
	 * documented top-level types, which leaves conceptual queries about view
	 * modifiers with nothing to match against.
	 */
	getMemberSymbolsForEnrichment(
		frameworks: string[] = ['SwiftUI', 'UIKit'],
	): Array<{
		id: string;
		title: string;
		kind: string;
		framework: string;
		abstract: string;
		path: string;
	}> {
		const frameworkPlaceholders = frameworks.map(() => '?').join(', ');
		return this.db
			.prepare(
				`SELECT id, title, kind, framework, COALESCE(abstract, '') AS abstract, path
         FROM symbols
         WHERE framework IN (${frameworkPlaceholders})
           AND lower(kind) IN ('method', 'property', 'init', 'subscript', 'case', 'op', 'func', 'var')
           AND (abstract IS NULL OR abstract = '')
         ORDER BY framework ASC, path ASC`,
			)
			.all(...frameworks) as Array<{
			id: string;
			title: string;
			kind: string;
			framework: string;
			abstract: string;
			path: string;
		}>;
	}

	/** Ids already present in the semantic layer — the resume key set. */
	getSemanticItemIds(): Set<string> {
		const rows = this.db
			.prepare(`SELECT id FROM semantic_items`)
			.all() as Array<{ id: string }>;
		return new Set(rows.map((row) => row.id));
	}

	updateSymbolAbstract(id: string, abstract: string): void {
		this.db
			.prepare(`UPDATE symbols SET abstract = ? WHERE id = ?`)
			.run(abstract, id);
	}

	/** Rows stored with a generic `symbol`/`unknown` kind. */
	getUnclassifiedSymbols(): Array<{
		id: string;
		path: string;
		framework: string;
		kind: string;
		title: string;
	}> {
		const placeholders = UNCLASSIFIED_KINDS.map(() => '?').join(', ');
		return this.db
			.prepare(
				`SELECT id, path, framework, kind, title FROM symbols WHERE lower(kind) IN (${placeholders})`,
			)
			.all(...UNCLASSIFIED_KINDS) as Array<{
			id: string;
			path: string;
			framework: string;
			kind: string;
			title: string;
		}>;
	}

	getSemanticItemCount(): number {
		// Must sit *before* the try/catch below: that catch converts every
		// failure into `0`, which is precisely the "0 semantic items" lie this
		// guard exists to prevent. A swallowed replacement error here made a
		// stale server report lexical-only search while holding 19k vectors.
		this.assertNotReplaced();
		try {
			const row = this.db
				.prepare(`SELECT count(*) as count FROM semantic_items`)
				.get() as {
				count: number;
			};
			return row?.count ?? 0;
		} catch (err) {
			logger.warn(
				'Failed to get semantic item count:',
				err instanceof Error ? err.message : String(err),
			);
			return 0;
		}
	}

	rebuildFTS(): void {
		this.db.exec("INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild')");
	}

	insertSymbol(sym: DbSymbol): void {
		const stmt = this.db.prepare(`
      INSERT INTO symbols (id, framework, title, kind, abstract, path, platforms, is_primary_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
      framework = excluded.framework,
      title = excluded.title,
      kind = CASE
      WHEN lower(excluded.kind) IN ('symbol', 'unknown')
      AND lower(symbols.kind) NOT IN ('symbol', 'unknown')
      THEN symbols.kind
      ELSE excluded.kind
      END,
      abstract = CASE WHEN excluded.abstract IS NOT NULL AND excluded.abstract != '' THEN excluded.abstract ELSE symbols.abstract END,
      path = excluded.path,
      platforms = CASE WHEN excluded.platforms IS NOT NULL AND excluded.platforms != '[]' AND excluded.platforms != '' THEN excluded.platforms ELSE symbols.platforms END,
      is_primary_type = CASE
      WHEN lower(excluded.kind) IN ('symbol', 'unknown')
      AND lower(symbols.kind) NOT IN ('symbol', 'unknown')
      THEN symbols.is_primary_type
      ELSE excluded.is_primary_type
      END
    `);
		stmt.run(
			sym.id,
			sym.framework,
			sym.title,
			sym.kind,
			sym.abstract || '',
			sym.path,
			JSON.stringify(sym.platforms || []),
			sym.isPrimaryType ? 1 : 0,
		);
	}

	invalidateVectorCache(): void {
		this.vectorCache = null;
	}

	insertSemanticItems(items: SemanticItem[]): void {
		if (items.length === 0) return;
		this.vectorCache = null; // Invalidate vector cache on new writes

		const insertSem = this.db.prepare(`
			INSERT OR REPLACE INTO semantic_items (id, framework, title, kind, summary, path, media_url, media_type, embedding)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const hasVec = this.hasVec;
		const deleteVec = hasVec
			? this.db.prepare('DELETE FROM vec_items WHERE id = ?')
			: null;
		const insertVec = hasVec
			? this.db.prepare('INSERT INTO vec_items(id, embedding) VALUES (?, ?)')
			: null;
		const vecDims = this.vecDimensions;

		const runBatch = this.db.transaction((batch: SemanticItem[]) => {
			for (const item of batch) {
				const buffer = Buffer.from(
					item.embedding.buffer,
					item.embedding.byteOffset,
					item.embedding.byteLength,
				);
				insertSem.run(
					item.id,
					item.framework,
					item.title,
					item.kind,
					item.summary,
					item.path,
					item.mediaUrl || null,
					item.mediaType || null,
					buffer,
				);

				if (
					hasVec &&
					deleteVec &&
					insertVec &&
					item.embedding &&
					item.embedding.length === vecDims
				) {
					try {
						deleteVec.run(item.id);
						insertVec.run(item.id, item.embedding);
					} catch (err) {
						logger.debug('Failed to insert into vec_items:', err);
					}
				}
			}
		});

		runBatch(items);
	}

	insertSemanticItem(item: SemanticItem): void {
		this.insertSemanticItems([item]);
	}

	getSemanticItems(framework?: string): SemanticItem[] {
		this.assertNotReplaced();
		if (!this.vectorCache) {
			const rows = this.db
				.prepare(
					'SELECT id, framework, title, kind, summary, path, media_url, media_type, embedding FROM semantic_items',
				)
				.all() as any[];
			const items: SemanticItem[] = [];
			for (const r of rows) {
				const buf = r.embedding as Buffer;
				const f32 = deserializeFloat32Array(buf);
				if (!f32 || f32.length === 0) continue;
				let normSq = 0;
				for (let i = 0; i < f32.length; i++) {
					normSq += f32[i] * f32[i];
				}
				items.push({
					id: r.id,
					framework: r.framework,
					title: r.title,
					kind: r.kind,
					summary: r.summary,
					path: r.path,
					mediaUrl: r.media_url || undefined,
					mediaType: r.media_type || undefined,
					embedding: f32,
					norm: Math.sqrt(normSq),
				});
			}
			this.vectorCache = items;
		}

		if (framework) {
			const target = framework.toLowerCase();
			return this.vectorCache.filter(
				(item) => item.framework.toLowerCase() === target,
			);
		}
		return this.vectorCache;
	}

	private queryLikePattern(
		pattern: string,
		framework?: string,
		limit = 20,
	): FTSResult[] {
		let sql = `
      SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type,
             CASE WHEN title LIKE ? THEN 1 ELSE 0 END AS title_match,
             length(title) AS title_len
      FROM symbols
      WHERE (title LIKE ? OR abstract LIKE ?)
    `;
		const params: (string | number)[] = [pattern, pattern, pattern];
		if (framework) {
			sql += ` AND framework = ? COLLATE NOCASE`;
			params.push(framework);
		}
		sql += ` ORDER BY title_match DESC, is_primary_type DESC, title_len ASC, title ASC LIMIT ?`;
		params.push(limit);

		const rows = this.db.prepare(sql).all(...params) as any[];
		return rows.map((r) => {
			const isTitleMatch = Boolean(r.title_match);
			const isPrimary = Boolean(r.is_primary_type);
			const titleLen = Number(r.title_len) || 0;
			const score =
				(isTitleMatch ? 10.0 : 1.0) +
				(isPrimary ? 5.0 : 0) -
				Math.min(5, titleLen * 0.1);
			return {
				id: r.id,
				framework: r.framework,
				title: r.title,
				kind: r.kind,
				abstract: r.abstract,
				path: r.path,
				platforms: safeParsePlatforms(r.platforms),
				isPrimaryType: isPrimary,
				score,
			};
		});
	}

	queryFTS(query: string, framework?: string, limit = 20): FTSResult[] {
		this.assertNotReplaced();
		const trimmed = query.trim();
		if (!trimmed) return [];

		// Queries with pure punctuation/wildcards and no alphanumeric characters return empty
		if (!/[a-zA-Z0-9]/.test(trimmed)) {
			return [];
		}

		// If query has wildcards (* or ?) attached to tokens or as single-token patterns
		if (
			/\w[*?]|[*?]\w/.test(trimmed) ||
			(!trimmed.includes(' ') &&
				(trimmed.includes('*') || trimmed.includes('?')))
		) {
			const pattern = trimmed
				.replace(/\*/g, '%')
				.replace(/\?/g, '_')
				.replace(/["']/g, '');
			return this.queryLikePattern(pattern, framework, limit);
		}

		// Strip characters that trigger FTS5 syntax errors
		const sanitized = trimmed
			.replace(/["'*^:(){}[\]~+]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (!sanitized) return [];

		let ftsQuery = '';
		const tokens = sanitized.split(' ').filter(Boolean);
		if (tokens.length === 1) {
			const single = tokens[0].replace(/\*+$/, '');
			const words = single
				.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
				.filter(Boolean);
			if (words.length > 1 && words.every((w) => w.length >= 2)) {
				const phrase = words.join(' ');
				ftsQuery = `("${single}"* OR "${phrase}")`;
			} else {
				ftsQuery = `"${single}"*`;
			}
		} else {
			ftsQuery = tokens.map((t) => `"${t.replace(/\*+$/, '')}"*`).join(' AND ');
		}

		const exactMatches: FTSResult[] = [];
		if (
			!trimmed.includes('*') &&
			!trimmed.includes('?') &&
			!trimmed.includes(' ')
		) {
			let exactSql = `
        SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
        FROM symbols
        WHERE title = ? COLLATE NOCASE
      `;
			const exactParams: (string | number)[] = [trimmed];
			if (framework) {
				exactSql += ` AND framework = ? COLLATE NOCASE`;
				exactParams.push(framework);
			}
			exactSql += ` ORDER BY is_primary_type DESC LIMIT 5`;
			try {
				const exactRows = this.db
					.prepare(exactSql)
					.all(...exactParams) as any[];
				for (const r of exactRows) {
					exactMatches.push({
						id: r.id,
						framework: r.framework,
						title: r.title,
						kind: r.kind,
						abstract: r.abstract,
						path: r.path,
						platforms: safeParsePlatforms(r.platforms),
						isPrimaryType: Boolean(r.is_primary_type),
						score: 1000.0,
					});
				}
			} catch (err) {
				logger.debug('queryFTS exact match query step failed:', err);
			}
		}

		let sql = `
      SELECT s.id, s.framework, s.title, s.kind, s.abstract, s.path, s.platforms, s.is_primary_type,
             bm25(symbols_fts, 10.0, 2.0, 1.0, 0.5) AS rank
      FROM symbols_fts f
      JOIN symbols s ON s.rowid = f.rowid
      WHERE symbols_fts MATCH ?
    `;
		const params: (string | number)[] = [ftsQuery];

		if (framework) {
			sql += ` AND s.framework = ? COLLATE NOCASE`;
			params.push(framework);
		}

		sql += ` ORDER BY rank ASC LIMIT ?`;
		params.push(limit);

		try {
			const rows = this.db.prepare(sql).all(...params) as any[];
			const seen = new Set<string>();
			const combined: FTSResult[] = [];

			for (const m of exactMatches) {
				seen.add(m.id);
				combined.push(m);
			}

			for (const r of rows) {
				if (!seen.has(r.id)) {
					seen.add(r.id);
					combined.push({
						id: r.id,
						framework: r.framework,
						title: r.title,
						kind: r.kind,
						abstract: r.abstract,
						path: r.path,
						platforms: safeParsePlatforms(r.platforms),
						isPrimaryType: Boolean(r.is_primary_type),
						score: -r.rank,
					});
				}
			}

			// If multi-token query yielded zero results with AND, fall back to OR matching with BM25 ranking
			if (combined.length === 0 && tokens.length > 1) {
				const orQuery = tokens
					.map((t) => `"${t.replace(/\*+$/, '')}"*`)
					.join(' OR ');
				const orParams: (string | number)[] = [orQuery];
				if (framework) {
					orParams.push(framework);
				}
				orParams.push(limit);
				try {
					const orRows = this.db.prepare(sql).all(...orParams) as any[];
					for (const r of orRows) {
						if (!seen.has(r.id)) {
							seen.add(r.id);
							combined.push({
								id: r.id,
								framework: r.framework,
								title: r.title,
								kind: r.kind,
								abstract: r.abstract,
								path: r.path,
								platforms: safeParsePlatforms(r.platforms),
								isPrimaryType: Boolean(r.is_primary_type),
								score: -r.rank * 0.5,
							});
						}
					}
				} catch (err) {
					logger.debug('queryFTS OR fallback step failed:', err);
				}
			}

			return combined.slice(0, limit);
		} catch (err) {
			logger.warn(
				'Warning: SQLite FTS5 MATCH failed, falling back to LIKE query:',
				err instanceof Error ? err.message : err,
			);
			// Safe fallback to LIKE query if FTS expression has syntax issue
			return this.queryLike(sanitized, framework, limit);
		}
	}

	private queryLike(
		query: string,
		framework?: string,
		limit = 20,
	): FTSResult[] {
		let sql = `
      SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
      FROM symbols
      WHERE (title LIKE ? ESCAPE '\\' OR abstract LIKE ? ESCAPE '\\')
    `;
		const escaped = query
			.replace(/\\/g, '\\\\')
			.replace(/%/g, '\\%')
			.replace(/_/g, '\\_');
		const term = `%${escaped}%`;
		const params: (string | number)[] = [term, term];

		if (framework) {
			sql += ` AND framework = ? COLLATE NOCASE`;
			params.push(framework);
		}

		sql += ` LIMIT ?`;
		params.push(limit);

		try {
			const rows = this.db.prepare(sql).all(...params) as any[];
			return rows.map((r) => ({
				id: r.id,
				framework: r.framework,
				title: r.title,
				kind: r.kind,
				abstract: r.abstract,
				path: r.path,
				platforms: safeParsePlatforms(r.platforms),
				isPrimaryType: Boolean(r.is_primary_type),
				score: 1.0,
			}));
		} catch (err) {
			logger.warn(
				'queryLike failed:',
				err instanceof Error ? err.message : String(err),
			);
			return [];
		}
	}

	resolveSymbol(
		pathOrTitle: string,
		framework?: string,
	): { symbol?: DbSymbol; candidates?: DbSymbol[] } {
		const raw = pathOrTitle.trim();
		if (!raw) return {};

		const clean = raw.startsWith('/') ? raw.slice(1) : raw;
		const mapRow = (r: any): DbSymbol => ({
			id: r.id,
			framework: r.framework,
			title: r.title,
			kind: r.kind,
			abstract: r.abstract,
			path: r.path,
			platforms: safeParsePlatforms(r.platforms),
			isPrimaryType: Boolean(r.is_primary_type),
		});

		// 1. Exact path or ID match
		let exactSql = `
			SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
			FROM symbols
			WHERE (path = ? OR path = ? OR id = ? OR id = ?)
		`;
		const exactParams: (string | number)[] = [
			raw,
			clean,
			`/${clean}`,
			`documentation/${clean}`,
		];
		if (framework) {
			exactSql += ` AND framework = ? COLLATE NOCASE`;
			exactParams.push(framework);
		}
		exactSql += ` LIMIT 1`;
		try {
			const exactRow = this.db.prepare(exactSql).get(...exactParams) as any;
			if (exactRow) {
				return { symbol: mapRow(exactRow) };
			}
		} catch (err) {
			logger.debug('resolveSymbol exact match step failed:', err);
		}

		// 2. Case-insensitive path match
		let caseSql = `
			SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
			FROM symbols
			WHERE (path = ? COLLATE NOCASE OR path = ? COLLATE NOCASE OR id = ? COLLATE NOCASE OR id = ? COLLATE NOCASE)
		`;
		const caseParams: (string | number)[] = [
			raw,
			clean,
			`/${clean}`,
			`documentation/${clean}`,
		];
		if (framework) {
			caseSql += ` AND framework = ? COLLATE NOCASE`;
			caseParams.push(framework);
		}
		caseSql += ` LIMIT 1`;
		try {
			const caseRow = this.db.prepare(caseSql).get(...caseParams) as any;
			if (caseRow) {
				return { symbol: mapRow(caseRow) };
			}
		} catch (err) {
			logger.debug('resolveSymbol case-insensitive match step failed:', err);
		}

		// 3. Normalized <Framework>/<Symbol> path attempt (e.g. SwiftUI/NavigationStack)
		const slashIdx = clean.indexOf('/');
		if (slashIdx > 0 && !clean.toLowerCase().startsWith('documentation/')) {
			const fwPart = clean.slice(0, slashIdx);
			const symPart = clean.slice(slashIdx + 1);
			const candidatePath = `/documentation/${fwPart.toLowerCase()}/${symPart.toLowerCase()}`;
			let candSql = `
				SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
				FROM symbols
				WHERE path = ? COLLATE NOCASE
			`;
			const candParams: (string | number)[] = [candidatePath];
			if (framework || fwPart) {
				candSql += ` AND framework = ? COLLATE NOCASE`;
				candParams.push(framework || fwPart);
			}
			candSql += ` LIMIT 1`;
			try {
				const candRow = this.db.prepare(candSql).get(...candParams) as any;
				if (candRow) {
					return { symbol: mapRow(candRow) };
				}
			} catch (err) {
				logger.debug(
					'resolveSymbol framework/symbol candidate step failed:',
					err,
				);
			}
		}

		// 4. Exact Title match (COLLATE NOCASE)
		let titleSql = `
			SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
			FROM symbols
			WHERE title = ? COLLATE NOCASE
		`;
		const titleParams: (string | number)[] = [raw];
		if (framework) {
			titleSql += ` AND framework = ? COLLATE NOCASE`;
			titleParams.push(framework);
		}
		titleSql += ` ORDER BY is_primary_type DESC, length(path) ASC LIMIT 10`;
		try {
			const titleRows = this.db.prepare(titleSql).all(...titleParams) as any[];
			if (titleRows.length === 1) {
				return { symbol: mapRow(titleRows[0]) };
			}
			if (titleRows.length > 1) {
				return { candidates: titleRows.map(mapRow) };
			}
		} catch (err) {
			logger.debug('resolveSymbol exact title match step failed:', err);
		}

		// 5. Path Suffix match (e.g. NavigationStack or View at end of path)
		let suffixSql = `
			SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
			FROM symbols
			WHERE path LIKE '%/' || ? COLLATE NOCASE
		`;
		const suffixParams: (string | number)[] = [clean];
		if (framework) {
			suffixSql += ` AND framework = ? COLLATE NOCASE`;
			suffixParams.push(framework);
		}
		suffixSql += ` ORDER BY is_primary_type DESC, length(path) ASC LIMIT 10`;
		try {
			const suffixRows = this.db
				.prepare(suffixSql)
				.all(...suffixParams) as any[];
			if (suffixRows.length === 1) {
				return { symbol: mapRow(suffixRows[0]) };
			}
			if (suffixRows.length > 1) {
				return { candidates: suffixRows.map(mapRow) };
			}
		} catch (err) {
			logger.debug('resolveSymbol suffix match step failed:', err);
		}

		// 6. Function or method signature match (e.g. SecItemAdd matching /documentation/security/secitemadd(_:_:))
		const cleanPath = clean.startsWith('/') ? clean : `/${clean}`;
		let funcSql = `
			SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
			FROM symbols
			WHERE (
				path LIKE '%/' || ? || '(%' COLLATE NOCASE
				OR path LIKE '%/' || ? || '-%' COLLATE NOCASE
				OR path LIKE ? || '(%' COLLATE NOCASE
				OR path LIKE ? || '-%' COLLATE NOCASE
				OR title LIKE 'func ' || ? || '(%' COLLATE NOCASE
				OR title LIKE 'func ' || ? || '<%' COLLATE NOCASE
				OR title LIKE 'var ' || ? || ':%' COLLATE NOCASE
				OR title LIKE 'let ' || ? || ':%' COLLATE NOCASE
				OR title LIKE ? || '(%' COLLATE NOCASE
			)
		`;
		const funcParams: (string | number)[] = [
			clean,
			clean,
			cleanPath,
			cleanPath,
			clean,
			clean,
			clean,
			clean,
			clean,
		];
		if (framework) {
			funcSql += ` AND framework = ? COLLATE NOCASE`;
			funcParams.push(framework);
		}
		funcSql += ` ORDER BY is_primary_type DESC, length(path) ASC LIMIT 10`;
		try {
			const funcRows = this.db.prepare(funcSql).all(...funcParams) as any[];
			if (funcRows.length === 1) {
				return { symbol: mapRow(funcRows[0]) };
			}
			if (funcRows.length > 1) {
				return { candidates: funcRows.map(mapRow) };
			}
		} catch (err) {
			logger.debug('resolveSymbol function/method signature step failed:', err);
		}

		return {};
	}

	getSymbolByPath(path: string): DbSymbol | null {
		return this.resolveSymbol(path).symbol || null;
	}

	getFrameworks(): string[] {
		const rows = this.db
			.prepare('SELECT DISTINCT framework FROM symbols ORDER BY framework')
			.all() as any[];
		return rows.map((r) => r.framework);
	}

	getPrimarySymbols(
		framework: string,
		limit = 100,
	): Array<{
		id: string;
		title: string;
		kind: string;
		path: string;
		abstract: string;
	}> {
		try {
			const rows = this.db
				.prepare(
					`SELECT id, title, kind, path, abstract
					 FROM symbols
					 WHERE framework = ? COLLATE NOCASE AND is_primary_type = 1
					 ORDER BY title ASC
					 LIMIT ?`,
				)
				.all(framework, limit) as Array<{
				id: string;
				title: string;
				kind: string;
				path: string;
				abstract: string;
			}>;
			return rows;
		} catch (err) {
			logger.debug('getPrimarySymbols failed:', err);
			return [];
		}
	}

	findFuzzySuggestions(
		query: string,
		framework?: string,
		maxSuggestions = 3,
	): Array<{
		title: string;
		framework: string;
		path: string;
		kind: string;
		distance: number;
	}> {
		const raw = query.trim();
		if (!raw || raw.length < 2) return [];

		// Extract symbol name and infer framework if path format (e.g. SwiftUI/NavgationStack -> NavgationStack)
		let targetFramework = framework;
		let targetName = raw;
		if (raw.includes('/')) {
			const parts = raw.split('/').filter(Boolean);
			targetName = parts.at(-1) || raw;
			if (!targetFramework) {
				const inferred = canonicalFrameworkFromSlug(frameworkSlugFromPath(raw));
				if (inferred) {
					targetFramework = inferred;
				}
			}
		}

		// Clean method parenthesis if provided (e.g. onAppear() -> onAppear)
		const cleanTargetName = targetName.replace(/\(.*\)$/, '');

		const maxDist =
			cleanTargetName.length <= 4 ? 1 : cleanTargetName.length <= 8 ? 2 : 3;

		let sql = `
			SELECT title, framework, path, kind, is_primary_type
			FROM symbols
			WHERE (abs(length(title) - ?) <= ?
			   OR is_primary_type = 1
			   OR path LIKE '%/' || ? || '%')
		`;
		const params: (string | number)[] = [
			cleanTargetName.length,
			maxDist,
			cleanTargetName.toLowerCase(),
		];

		if (targetFramework) {
			sql += ` AND framework = ? COLLATE NOCASE`;
			params.push(targetFramework);
		}

		try {
			const rows = this.db.prepare(sql).all(...params) as Array<{
				title: string;
				framework: string;
				path: string;
				kind: string;
				is_primary_type: number;
			}>;

			const scored: Array<{
				title: string;
				framework: string;
				path: string;
				kind: string;
				isPrimary: boolean;
				distance: number;
			}> = [];

			const seen = new Set<string>();

			for (const row of rows) {
				const key = `${row.framework}:${row.path}`;
				if (seen.has(key)) continue;
				seen.add(key);

				const distTitle = levenshteinDistance(cleanTargetName, row.title);
				const lastPathSeg = row.path.split('/').filter(Boolean).at(-1) || '';
				const shortSlug = lastPathSeg.replace(/\(.*\)$/, '');
				const distSlug = shortSlug
					? levenshteinDistance(cleanTargetName, shortSlug)
					: 999;

				const bestDist = Math.min(distTitle, distSlug);
				if (bestDist <= maxDist) {
					scored.push({
						title: row.title,
						framework: row.framework,
						path: row.path,
						kind: row.kind,
						isPrimary: Boolean(row.is_primary_type),
						distance: bestDist,
					});
				}
			}

			scored.sort((a, b) => {
				if (a.distance !== b.distance) return a.distance - b.distance;
				if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
				return a.title.length - b.title.length;
			});

			return scored
				.slice(0, maxSuggestions)
				.map(({ title, framework, path, kind, distance }) => ({
					title,
					framework,
					path,
					kind,
					distance,
				}));
		} catch (err) {
			logger.debug('findFuzzySuggestions failed:', err);
			return [];
		}
	}

	syncVecIndex(): void {
		if (!this.hasVec) return;
		try {
			const tblCheck = this.db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' AND name='vec_items'",
				)
				.get();
			if (!tblCheck) return;

			const targetBytes = this.vecDimensions * 4;
			const semRow = this.db
				.prepare(
					'SELECT count(*) as c FROM semantic_items WHERE length(embedding) = ?',
				)
				.get(targetBytes) as { c: number } | undefined;
			const vecRow = this.db
				.prepare('SELECT count(*) as c FROM vec_items')
				.get() as { c: number } | undefined;

			const semCount = semRow?.c ?? 0;
			const vecCount = vecRow?.c ?? 0;

			if (semCount > 0 && vecCount < semCount) {
				if (vecCount === 0) {
					this.db
						.prepare(
							`INSERT INTO vec_items(id, embedding)
							 SELECT id, embedding FROM semantic_items
							 WHERE length(embedding) = ?`,
						)
						.run(targetBytes);
				} else {
					this.db
						.prepare(
							`INSERT INTO vec_items(id, embedding)
							 SELECT id, embedding FROM semantic_items
							 WHERE length(embedding) = ?
							 AND id NOT IN (SELECT id FROM vec_items)`,
						)
						.run(targetBytes);
				}
			}
		} catch (err) {
			logger.debug('Failed to sync vec_items:', err);
		}
	}

	importVectorsFromDb(sourceDbPath: string): number {
		this.db.prepare('ATTACH DATABASE ? AS src').run(sourceDbPath);
		try {
			const insertSql = `
				INSERT OR REPLACE INTO main.semantic_items
				(id, framework, title, kind, summary, path, embedding, media_url, media_type)
				SELECT id, framework, title, kind, summary, path, embedding, media_url, media_type
				FROM src.semantic_items;
			`;
			const result = this.db.prepare(insertSql).run();
			const count = result.changes;

			if (this.hasVec) {
				try {
					this.db.transaction(() => {
						this.db.exec(`
							DELETE FROM vec_items WHERE id IN (SELECT id FROM src.semantic_items);
							INSERT INTO vec_items(id, embedding)
							SELECT id, embedding FROM src.semantic_items
							WHERE length(embedding) = 3072;
						`);
					})();
				} catch (err) {
					logger.debug('Failed to sync vec_items on import:', err);
				}
			}

			this.vectorCache = null;

			const status = this.getEmbeddingStatus();
			this.setMeta('embedded_at', new Date().toISOString());
			this.setMeta('semantic_item_count', String(status.semanticItemCount));
			this.setMeta(
				'has_embeddings',
				status.storageHasVectors ? 'true' : 'false',
			);

			return count;
		} finally {
			try {
				this.db.prepare('DETACH DATABASE src').run();
			} catch {}
		}
	}

	isVecAccelerated(): boolean {
		return this.hasVec;
	}

	queryVectorNearest(
		queryVec: Float32Array,
		limit = 20,
		framework?: string,
	): Array<{
		id: string;
		framework: string;
		title: string;
		kind: string;
		summary: string;
		path: string;
		mediaUrl?: string;
		mediaType?: string;
		similarity: number;
	}> {
		this.assertNotReplaced();
		if (!this.hasVec || queryVec.length !== this.vecDimensions) {
			return [];
		}
		try {
			const tblCheck = this.db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' AND name='vec_items'",
				)
				.get();
			if (!tblCheck) return [];

			let rows: any[];
			if (framework) {
				const fetchLimit = Math.max(limit * 20, 200);
				const stmt = this.db.prepare(`
					SELECT s.id, s.framework, s.title, s.kind, s.summary, s.path, s.media_url, s.media_type, v.distance
					FROM vec_items v
					JOIN semantic_items s ON v.id = s.id
					WHERE v.embedding MATCH ? AND k = ? AND LOWER(s.framework) = LOWER(?)
					ORDER BY v.distance ASC
				`);
				rows = stmt.all(queryVec, fetchLimit, framework) as any[];
			} else {
				const stmt = this.db.prepare(`
					SELECT s.id, s.framework, s.title, s.kind, s.summary, s.path, s.media_url, s.media_type, v.distance
					FROM vec_items v
					JOIN semantic_items s ON v.id = s.id
					WHERE v.embedding MATCH ? AND k = ?
					ORDER BY v.distance ASC
				`);
				rows = stmt.all(queryVec, limit) as any[];
			}

			return rows.map((r) => ({
				id: r.id,
				framework: r.framework,
				title: r.title,
				kind: r.kind,
				summary: r.summary,
				path: r.path,
				mediaUrl: r.media_url || undefined,
				mediaType: r.media_type || undefined,
				similarity: Math.max(
					0,
					1 - (typeof r.distance === 'number' ? r.distance : 0),
				),
			}));
		} catch (err) {
			logger.debug(
				'queryVectorNearest failed, falling back to in-memory search:',
				err,
			);
			return [];
		}
	}

	checkpointAndVacuum(): void {
		this.db.pragma('wal_checkpoint(TRUNCATE)');
		this.db.exec('VACUUM');
	}

	close(): void {
		if (this.fd !== null) {
			try {
				closeSync(this.fd);
			} catch {}
			this.fd = null;
		}
		this.db.close();
	}
}
