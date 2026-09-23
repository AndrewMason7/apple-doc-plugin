export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS symbols (
    id TEXT PRIMARY KEY,
    framework TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    abstract TEXT,
    path TEXT NOT NULL,
    platforms TEXT,
    is_primary_type INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
    title,
    framework,
    kind,
    abstract,
    content='symbols',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
    INSERT INTO symbols_fts(rowid, title, framework, kind, abstract)
    VALUES (new.rowid, new.title, new.framework, new.kind, new.abstract);
END;

CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
    INSERT INTO symbols_fts(symbols_fts, rowid, title, framework, kind, abstract)
    VALUES('delete', old.rowid, old.title, old.framework, old.kind, old.abstract);
END;

CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
    INSERT INTO symbols_fts(symbols_fts, rowid, title, framework, kind, abstract)
    VALUES('delete', old.rowid, old.title, old.framework, old.kind, old.abstract);
    INSERT INTO symbols_fts(rowid, title, framework, kind, abstract)
    VALUES (new.rowid, new.title, new.framework, new.kind, new.abstract);
END;

CREATE TABLE IF NOT EXISTS semantic_items (
    id TEXT PRIMARY KEY,
    framework TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    path TEXT NOT NULL,
    embedding BLOB NOT NULL
);
`;
//# sourceMappingURL=schema.js.map