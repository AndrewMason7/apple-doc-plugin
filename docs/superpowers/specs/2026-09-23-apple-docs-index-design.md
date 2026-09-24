# Apple Developer Documentation Index & Hybrid Search MCP Plugin — Architecture Spec

## 1. Executive Summary

This specification defines the architecture for transforming the `apple-doc-plugin` into a next-generation AI agent documentation plugin.

Current limitations in upstream include:

- **Mandatory stateful selection**: Agents cannot search without first calling `choose_technology`.
- **Empty cache on launch**: The existing `LocalSymbolIndex` relies on a local `.cache/` folder that starts empty on install.
- **Pure substring/in-memory token matching**: No persistent database, no BM25 ranking, no semantic understanding.

This design introduces:

1. **Pre-indexed SQLite + FTS5 database** bundled with the plugin, enabling instant (<1ms) offline search across 100k+ core Apple symbols.
2. **Stateless Global Search First**: Agents can query symbols directly without pre-selecting a framework, while maintaining backwards compatibility for existing workflows.
3. **Hybrid Search with Gemini Embeddings**: Optional semantic search for natural language conceptual queries using Google Gemini embeddings (`text-embedding-004`), with seamless zero-config fallback to pure FTS5.
4. **Clean DocC Markdown Generation**: On-demand retrieval and conversion of Apple's DocC AST into concise, context-optimized Markdown.

---

## 2. Architectural Boundaries & Separation of Concerns (SoC)

Strictly separating data persistence, external API communication, search indexing, and MCP tool handling:

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Tool Layer                         │
│  (tools.ts, handlers: search-symbols, get-doc, discover)   │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
┌──────────────▼──────────────┐ ┌──────────────▼──────────────┐
│     Hybrid Search Service   │ │      DocC Content Service   │
│   (search-engine.ts, FTS5)  │ │      (apple-client.ts)      │
└──────┬───────────────┬──────┘ └──────────────┬──────────────┘
       │               │                       │
┌──────▼──────┐ ┌──────▼──────┐         ┌──────▼──────────────┐
│  SQLite DB  │ │ Gemini API  │         │ Apple Developer API │
│  (FTS5 BM25)│ │ (Embeddings)│         │   (tutorials/data)  │
└─────────────┘ └─────────────┘         └─────────────────────┘
```

1. **Storage Layer (`src/server/db/`)**:
   - `database.ts`: Manages `better-sqlite3` connection, migrations, FTS5 table initialization, and read/write handles.
   - Manages bundled seed database (`data/apple-docs.db`) and runtime user cache in `~/.cache/apple-doc-mcp/`.
2. **Search Engine Layer (`src/server/services/search/`)**:
   - `fts-search.ts`: High-speed tokenized FTS5 queries with BM25 ranking, prefix matching (`*`), and exact symbol boosting.
   - `semantic-search.ts`: Gemini query embedding (`text-embedding-004`) + vector cosine similarity over technology guides and primary types.
   - `hybrid-search.ts`: Reciprocal Rank Fusion (RRF) combining lexical and semantic scores.
3. **Ingestion & Indexing Pipeline (`scripts/build-index.ts`)**:
   - Crawls Apple's public DocC API for core frameworks (SwiftUI, UIKit, Foundation, SwiftData, Combine, AppKit, Swift Standard Library).
   - Populates SQLite tables and pre-computes Gemini embeddings for technology overviews and key types if `GEMINI_API_KEY` is present.
4. **Apple Client Layer (`src/apple-client/`)**:
   - Fetches DocC JSON nodes on-demand for `get_documentation` requests.
   - Transforms DocC AST into clean, token-efficient Markdown.
5. **MCP Server & Tool Handlers (`src/server/`)**:
   - `search_symbols(query, framework?, limit?)`: Global by default, scoped if `framework` is supplied.
   - `get_documentation(path)`: Detailed documentation reader.
   - `discover_technologies`, `choose_technology`, `current_technology`, `get_version`: Backward-compatible legacy handlers.

---

## 3. Database Schema

The SQLite database (`apple-docs.db`) uses the following schema:

```sql
-- Metadata table
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Core symbols table
CREATE TABLE IF NOT EXISTS symbols (
    id TEXT PRIMARY KEY,           -- e.g. "documentation/swiftui/navigationstack"
    framework TEXT NOT NULL,       -- e.g. "SwiftUI"
    title TEXT NOT NULL,           -- e.g. "NavigationStack"
    kind TEXT NOT NULL,            -- e.g. "struct", "class", "protocol", "func"
    abstract TEXT,                 -- Short summary
    path TEXT NOT NULL,            -- Relative DocC path
    platforms TEXT,                -- JSON string: ["iOS 16.0+", "macOS 13.0+"]
    is_primary_type INTEGER DEFAULT 0 -- 1 for struct/class/protocol/macro
);

-- Full-Text Search (FTS5) table with BM25
CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
    title,
    framework,
    kind,
    abstract,
    content='symbols',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

-- Triggers to keep FTS index synced
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

-- Semantic embeddings table for conceptual discovery
CREATE TABLE IF NOT EXISTS semantic_items (
    id TEXT PRIMARY KEY,
    framework TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,            -- "guide", "technology", "primary_type"
    summary TEXT NOT NULL,
    path TEXT NOT NULL,
    embedding BLOB NOT NULL        -- 768 float32 bytes (3072 bytes)
);
```

---

## 4. Search & Ranking Algorithm

### 4.1. Lexical Scoring (FTS5 BM25 + Exact Match Booster)

1. Exact match on symbol title (e.g. `query == "NavigationStack"`): $+100.0$ score boost.
2. Prefix match (e.g. `query == "Navig*"`): FTS5 prefix expansion.
3. Substring / CamelCase tokenization: Query decomposed into sub-tokens (`Navigation`, `Stack`) matched across `title`, `abstract`, and `framework`.
4. Platform and framework filtering: If `framework` argument is provided, the query is scoped via `WHERE framework = ? COLLATE NOCASE`.

### 4.2. Semantic Scoring (Gemini `text-embedding-004`)

1. If `GEMINI_API_KEY` is present:
   - Call Gemini API to compute 768-dimensional float embedding for query.
   - Calculate cosine similarity against `semantic_items` embeddings:
     $$\text{cosine\_sim}(\vec{q}, \vec{d}) = \frac{\vec{q} \cdot \vec{d}}{\|\vec{q}\| \|\vec{d}\|}$$
   - Filter matches with similarity $> 0.65$.
2. If `GEMINI_API_KEY` is not present:
   - Gracefully skip vector search; rely entirely on FTS5 without error.

### 4.3. Hybrid Merge (Reciprocal Rank Fusion - RRF)

When both lexical and semantic candidates exist:
$$\text{Score}(d) = \frac{1}{60 + \text{Rank}_{\text{fts}}(d)} + \frac{1}{60 + \text{Rank}_{\text{semantic}}(d)}$$
Returns top $N$ unique items (default 10, max 25) with exact API signature, kind, framework, platform availability, and doc path.

---

## 5. Backward Compatibility & Migration

All existing tools from upstream remain functional:

- `discover_technologies`: Returns list of frameworks from DB/API.
- `choose_technology`: Still updates state for tools that depend on it.
- `search_symbols`: Now works **both** with or without a chosen technology! If no technology is chosen, it runs a global search. If a technology is chosen, it defaults to scoping to that technology unless overridden by an explicit argument.
- `get_documentation`: Fetches full details for any symbol path.
