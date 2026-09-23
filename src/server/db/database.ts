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

export function deserializeFloat32Array(buf: Buffer): Float32Array {
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
  private db: Database.Database;
  private vectorCache: SemanticItem[] | null = null;

  constructor(dbPath: string, options: Database.Options = {}) {
    this.db = new Database(dbPath, options);
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

  insertSymbol(sym: DbSymbol): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbols (id, framework, title, kind, abstract, path, platforms, is_primary_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      sym.id,
      sym.framework,
      sym.title,
      sym.kind,
      sym.abstract || '',
      sym.path,
      JSON.stringify(sym.platforms || []),
      sym.isPrimaryType ? 1 : 0
    );
  }

  insertSemanticItem(item: SemanticItem): void {
    this.vectorCache = null; // Invalidate vector cache on new writes
    const buffer = Buffer.from(item.embedding.buffer, item.embedding.byteOffset, item.embedding.byteLength);
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
      buffer
    );
  }

  getSemanticItems(framework?: string): SemanticItem[] {
    if (!this.vectorCache) {
      const rows = this.db
        .prepare('SELECT id, framework, title, kind, summary, path, media_url, media_type, embedding FROM semantic_items')
        .all() as any[];
      this.vectorCache = rows.map((r) => {
        const buf = r.embedding as Buffer;
        const f32 = deserializeFloat32Array(buf);
        let normSq = 0;
        for (let i = 0; i < f32.length; i++) {
          normSq += f32[i] * f32[i];
        }
        return {
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
        };
      });
    }

    if (framework) {
      const target = framework.toLowerCase();
      return this.vectorCache.filter((item) => item.framework.toLowerCase() === target);
    }
    return this.vectorCache;
  }

  queryFTS(query: string, framework?: string, limit = 20): FTSResult[] {
    // Strip characters that trigger FTS5 syntax errors
    const sanitized = query.replace(/["'*^:(){}[\]~+]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!sanitized) return [];

    let ftsQuery = '';
    const tokens = sanitized.split(' ').filter(Boolean);
    if (tokens.length === 1) {
      const single = tokens[0];
      const camelParts = single.split(/(?=[A-Z])/).filter(Boolean);
      if (camelParts.length > 1) {
        const tokenQuery = camelParts.map((p) => `"${p}"*`).join(' AND ');
        ftsQuery = `("${single}"* OR (${tokenQuery}))`;
      } else {
        ftsQuery = `"${single}"*`;
      }
    } else {
      ftsQuery = tokens.map((t) => `"${t}"*`).join(' AND ');
    }

    let sql = `
      SELECT s.id, s.framework, s.title, s.kind, s.abstract, s.path, s.platforms, s.is_primary_type,
             bm25(symbols_fts) AS rank
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
      return rows.map((r) => ({
        id: r.id,
        framework: r.framework,
        title: r.title,
        kind: r.kind,
        abstract: r.abstract,
        path: r.path,
        platforms: safeParsePlatforms(r.platforms),
        isPrimaryType: Boolean(r.is_primary_type),
        score: -r.rank, // Invert BM25 so higher score is better match
      }));
    } catch {
      // Safe fallback to LIKE query if FTS expression has syntax issue
      return this.queryLike(sanitized, framework, limit);
    }
  }

  private queryLike(query: string, framework?: string, limit = 20): FTSResult[] {
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

  getSymbolByPath(path: string): DbSymbol | null {
    const clean = path.startsWith('/') ? path.slice(1) : path;
    const row = this.db.prepare(`
      SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
      FROM symbols
      WHERE path = ? OR path = ? OR id = ?
      LIMIT 1
    `).get(clean, `/${clean}`, clean) as any;

    if (!row) return null;
    return {
      id: row.id,
      framework: row.framework,
      title: row.title,
      kind: row.kind,
      abstract: row.abstract,
      path: row.path,
      platforms: safeParsePlatforms(row.platforms),
      isPrimaryType: Boolean(row.is_primary_type),
    };
  }

  getFrameworks(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT framework FROM symbols ORDER BY framework').all() as any[];
    return rows.map((r) => r.framework);
  }

  close(): void {
    this.db.close();
  }
}
