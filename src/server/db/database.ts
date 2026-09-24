import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

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
	} catch {
		return [];
	}
}

export class AppleDocsDB {
	public readonly dbPath: string;
	private db: Database.Database;
	private vectorCache: SemanticItem[] | null = null;

	constructor(dbPath: string, options: Database.Options = {}) {
		this.dbPath = dbPath;
		this.db = new Database(dbPath, options);
		if (!options.readonly) {
			this.db.pragma('journal_mode = WAL');
			this.db.exec(SCHEMA_SQL);
			// Safe column migrations for existing databases
			try {
				this.db.exec('ALTER TABLE semantic_items ADD COLUMN media_url TEXT');
			} catch {}
			try {
				this.db.exec('ALTER TABLE semantic_items ADD COLUMN media_type TEXT');
			} catch {}
		}
	}

	setMeta(key: string, value: string): void {
		this.db
			.prepare(
				`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			)
			.run(key, value);
	}

	getMeta(key: string): string | undefined {
		try {
			const row = this.db
				.prepare(`SELECT value FROM meta WHERE key = ?`)
				.get(key) as { value: string } | undefined;
			return row?.value;
		} catch {
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
		} catch {
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
		} catch {
			return [];
		}
	}

	hasEmbeddings(): boolean {
		try {
			const row = this.db
				.prepare(`SELECT count(*) as count FROM semantic_items`)
				.get() as {
				count: number;
			};
			return (row?.count ?? 0) > 0;
		} catch {
			return false;
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
        kind = excluded.kind,
        abstract = CASE WHEN excluded.abstract IS NOT NULL AND excluded.abstract != '' THEN excluded.abstract ELSE symbols.abstract END,
        path = excluded.path,
        platforms = CASE WHEN excluded.platforms IS NOT NULL AND excluded.platforms != '[]' AND excluded.platforms != '' THEN excluded.platforms ELSE symbols.platforms END,
        is_primary_type = excluded.is_primary_type
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

	insertSemanticItem(item: SemanticItem): void {
		this.vectorCache = null; // Invalidate vector cache on new writes
		const buffer = Buffer.from(
			item.embedding.buffer,
			item.embedding.byteOffset,
			item.embedding.byteLength,
		);
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO semantic_items (id, framework, title, kind, summary, path, media_url, media_type, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
		stmt.run(
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
	}

	getSemanticItems(framework?: string): SemanticItem[] {
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
		const trimmed = query.trim();
		if (!trimmed) return [];

		// If query has suffix wildcard (*Item) or single-char wildcard (?)
		if (trimmed.startsWith('*') || trimmed.includes('?')) {
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
			const camelParts = single.split(/(?=[A-Z])/).filter(Boolean);
			if (camelParts.length > 1) {
				const tokenQuery = camelParts.map((p) => `"${p}"*`).join(' AND ');
				ftsQuery = `("${single}"* OR (${tokenQuery}))`;
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
			} catch {}
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
				} catch {}
			}

			return combined.slice(0, limit);
		} catch (err) {
			console.error(
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
		} catch {}

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
		} catch {}

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
			} catch {}
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
		} catch {}

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
			const suffixRows = this.db.prepare(suffixSql).all(...suffixParams) as any[];
			if (suffixRows.length === 1) {
				return { symbol: mapRow(suffixRows[0]) };
			}
			if (suffixRows.length > 1) {
				return { candidates: suffixRows.map(mapRow) };
			}
		} catch {}

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

	close(): void {
		this.db.close();
	}
}
