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
  embedding: Float32Array;
}

export class AppleDocsDB {
  private db: Database.Database;

  constructor(dbPath: string, options: Database.Options = {}) {
    this.db = new Database(dbPath, options);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
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
    const buffer = Buffer.from(item.embedding.buffer, item.embedding.byteOffset, item.embedding.byteLength);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO semantic_items (id, framework, title, kind, summary, path, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      item.id,
      item.framework,
      item.title,
      item.kind,
      item.summary,
      item.path,
      buffer
    );
  }

  getSemanticItems(framework?: string): SemanticItem[] {
    let sql = 'SELECT id, framework, title, kind, summary, path, embedding FROM semantic_items';
    const params: string[] = [];
    if (framework) {
      sql += ' WHERE framework = ? COLLATE NOCASE';
      params.push(framework);
    }
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => {
      const buf = r.embedding as Buffer;
      const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
      return {
        id: r.id,
        framework: r.framework,
        title: r.title,
        kind: r.kind,
        summary: r.summary,
        path: r.path,
        embedding: f32,
      };
    });
  }

  queryFTS(query: string, framework?: string, limit = 20): FTSResult[] {
    const sanitized = query.replace(/['"]/g, '').trim();
    if (!sanitized) return [];

    let ftsQuery = sanitized;
    // If not a wildcard and doesn't contain spaces, add prefix wildcard and expand CamelCase
    if (!sanitized.includes('*') && !sanitized.includes(' ')) {
      const camelParts = sanitized.split(/(?=[A-Z])/).filter(Boolean);
      if (camelParts.length > 1) {
        const tokenQuery = camelParts.map((p) => `"${p}"*`).join(' AND ');
        ftsQuery = `("${sanitized}"* OR (${tokenQuery}))`;
      } else {
        ftsQuery = `"${sanitized}"*`;
      }
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
        platforms: r.platforms ? JSON.parse(r.platforms) : [],
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
      WHERE (title LIKE ? OR abstract LIKE ?)
    `;
    const term = `%${query}%`;
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
      platforms: r.platforms ? JSON.parse(r.platforms) : [],
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
      platforms: row.platforms ? JSON.parse(row.platforms) : [],
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
