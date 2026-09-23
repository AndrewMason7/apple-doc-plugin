import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';
export class AppleDocsDB {
    db;
    constructor(dbPath, options = {}) {
        this.db = new Database(dbPath, options);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(SCHEMA_SQL);
    }
    insertSymbol(sym) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbols (id, framework, title, kind, abstract, path, platforms, is_primary_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(sym.id, sym.framework, sym.title, sym.kind, sym.abstract || '', sym.path, JSON.stringify(sym.platforms || []), sym.isPrimaryType ? 1 : 0);
    }
    insertSemanticItem(item) {
        const buffer = Buffer.from(item.embedding.buffer, item.embedding.byteOffset, item.embedding.byteLength);
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO semantic_items (id, framework, title, kind, summary, path, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(item.id, item.framework, item.title, item.kind, item.summary, item.path, buffer);
    }
    getSemanticItems(framework) {
        let sql = 'SELECT id, framework, title, kind, summary, path, embedding FROM semantic_items';
        const params = [];
        if (framework) {
            sql += ' WHERE framework = ? COLLATE NOCASE';
            params.push(framework);
        }
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => {
            const buf = r.embedding;
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
    queryFTS(query, framework, limit = 20) {
        const sanitized = query.replace(/['"]/g, '').trim();
        if (!sanitized)
            return [];
        let ftsQuery = sanitized;
        // If not a wildcard and doesn't contain spaces, add prefix wildcard and expand CamelCase
        if (!sanitized.includes('*') && !sanitized.includes(' ')) {
            const camelParts = sanitized.split(/(?=[A-Z])/).filter(Boolean);
            if (camelParts.length > 1) {
                const tokenQuery = camelParts.map((p) => `"${p}"*`).join(' AND ');
                ftsQuery = `("${sanitized}"* OR (${tokenQuery}))`;
            }
            else {
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
        const params = [ftsQuery];
        if (framework) {
            sql += ` AND s.framework = ? COLLATE NOCASE`;
            params.push(framework);
        }
        sql += ` ORDER BY rank ASC LIMIT ?`;
        params.push(limit);
        try {
            const rows = this.db.prepare(sql).all(...params);
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
        }
        catch {
            // Safe fallback to LIKE query if FTS expression has syntax issue
            return this.queryLike(sanitized, framework, limit);
        }
    }
    queryLike(query, framework, limit = 20) {
        let sql = `
      SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
      FROM symbols
      WHERE (title LIKE ? OR abstract LIKE ?)
    `;
        const term = `%${query}%`;
        const params = [term, term];
        if (framework) {
            sql += ` AND framework = ? COLLATE NOCASE`;
            params.push(framework);
        }
        sql += ` LIMIT ?`;
        params.push(limit);
        const rows = this.db.prepare(sql).all(...params);
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
    getSymbolByPath(path) {
        const clean = path.startsWith('/') ? path.slice(1) : path;
        const row = this.db.prepare(`
      SELECT id, framework, title, kind, abstract, path, platforms, is_primary_type
      FROM symbols
      WHERE path = ? OR path = ? OR id = ?
      LIMIT 1
    `).get(clean, `/${clean}`, clean);
        if (!row)
            return null;
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
    getFrameworks() {
        const rows = this.db.prepare('SELECT DISTINCT framework FROM symbols ORDER BY framework').all();
        return rows.map((r) => r.framework);
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=database.js.map