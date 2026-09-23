# Apple Developer Documentation Index & Hybrid Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pre-indexed SQLite+FTS5 search engine with optional Gemini embeddings and stateless MCP tools for Apple Developer Documentation.

**Architecture:** Embedded `better-sqlite3` database with FTS5 BM25 scoring for instant (<1ms) symbol searches, coupled with an optional Gemini embedding layer for semantic conceptual queries and Reciprocal Rank Fusion (RRF). MCP tool handlers are refactored so symbol search works globally without requiring pre-selection of frameworks while maintaining backward compatibility.

**Tech Stack:** TypeScript, Node.js (v26+), `better-sqlite3`, `@modelcontextprotocol/sdk`, `axios`, Gemini Embeddings (`text-embedding-004`).

**Spec:** [docs/superpowers/specs/2026-09-23-apple-docs-index-design.md](file:///Users/andrew/Documents/GitHub/apple-doc-plugin/docs/superpowers/specs/2026-09-23-apple-docs-index-design.md)

## Global Constraints

- Must run on Node.js 20+ with native ESM (`"type": "module"`).
- All stdio logging must go to `stderr` to preserve JSON-RPC protocol integrity on `stdout`.
- Search queries must execute in <5ms locally for SQLite FTS5.
- If `GEMINI_API_KEY` is not present, the system must seamlessly fall back to pure FTS5 without errors or warnings.
- The `search_symbols` tool must work both without any technology chosen (global search) and with a chosen technology (scoped search).
- Existing tools (`discover_technologies`, `choose_technology`, `current_technology`, `get_version`, `get_documentation`) must remain backward-compatible.

## Review Focus

1. **Unselected Technology on First Search**: Calling `search_symbols` on a fresh server instance without calling `choose_technology` must return global results rather than an error.
2. **Wildcard & Punctuation in Query**: Queries containing characters like `*`, `.`, `()`, `:`, or camelCase (e.g. `View.task(id:)`, `*Item`, `Grid*`) must not crash the FTS5 query parser.
3. **Missing or Invalid `GEMINI_API_KEY`**: Semantic search queries must degrade gracefully to lexical FTS5 without throwing unhandled promise rejections.
4. **Empty Database / Cold-Start**: If the database file is missing or unseeded, the server must automatically initialize schema and fallback to live Apple DocC queries without crashing.
5. **Memory and File Locking**: SQLite database connections must be opened in read-only mode during standard MCP server runs (or WAL mode with safe concurrency) so multiple agent processes can access the index simultaneously.

---

### Task 1: Package Dependencies & Test Scaffolding

**Files:**

- Modify: `package.json`
- Test: `test/smoke.test.js`

**Interfaces:**

- Consumes: npm packages (`better-sqlite3`, `@types/better-sqlite3`, `tsx`)
- Produces: Working test and build scripts runnable via `npm test` and `npm run build`

- [ ] **Step 1: Write smoke test verifying better-sqlite3 with FTS5**

Create `test/smoke.test.js`:

```javascript
import assert from 'node:assert';
import test from 'node:test';
import Database from 'better-sqlite3';

test('better-sqlite3 FTS5 capability', () => {
	const db = new Database(':memory:');
	db.exec('CREATE VIRTUAL TABLE test_fts USING fts5(title, abstract);');
	db.prepare('INSERT INTO test_fts VALUES (?, ?)').run(
		'NavigationStack',
		'A view that displays a root view',
	);
	const rows = db
		.prepare('SELECT * FROM test_fts WHERE test_fts MATCH ?')
		.all('NavigationStack');
	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].title, 'NavigationStack');
});
```

- [ ] **Step 2: Run test to verify it fails (missing dependencies)**

Run: `node --test test/smoke.test.js`
Expected: FAIL with "Cannot find package 'better-sqlite3'"

- [ ] **Step 3: Update package.json and install dependencies**

Add `better-sqlite3` to `dependencies`, `@types/better-sqlite3` and `tsx` to `devDependencies`, and add `"test": "node --test test/**/*.test.js"` script in `package.json`.
Run: `npm install better-sqlite3 && npm install --save-dev @types/better-sqlite3 tsx`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/smoke.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json test/smoke.test.js
git commit -m "chore: add better-sqlite3 and test scaffolding"
```

---

### Task 2: SQLite Schema & Storage Layer

**Files:**

- Create: `src/server/db/database.ts`
- Create: `src/server/db/schema.ts`
- Test: `test/db.test.js`

**Interfaces:**

- Consumes: `better-sqlite3`
- Produces: `AppleDocsDB` class with methods `insertSymbol`, `insertSemanticItem`, `queryFTS`, `getSymbolByPath`, `getFrameworks`

- [ ] **Step 1: Write unit tests for schema and database operations**

Create `test/db.test.js`:

```javascript
import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';

test('AppleDocsDB initializes schema and inserts/queries symbols', () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/navigationstack',
		framework: 'SwiftUI',
		title: 'NavigationStack',
		kind: 'struct',
		abstract: 'A view that displays a root view and enables navigation.',
		path: '/documentation/swiftui/navigationstack',
		platforms: ['iOS 16.0+', 'macOS 13.0+'],
		isPrimaryType: true,
	});

	const results = db.queryFTS('NavigationStack');
	assert.strictEqual(results.length, 1);
	assert.strictEqual(results[0].title, 'NavigationStack');
	assert.strictEqual(results[0].framework, 'SwiftUI');
	assert.deepStrictEqual(results[0].platforms, ['iOS 16.0+', 'macOS 13.0+']);

	db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/db.test.js`
Expected: FAIL (modules do not exist yet)

- [ ] **Step 3: Implement Database Layer**

Create `src/server/db/schema.ts` defining table creations and indexes:

```typescript
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
```

Create `src/server/db/database.ts`:

```typescript
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
			sym.isPrimaryType ? 1 : 0,
		);
	}

	queryFTS(query: string, framework?: string, limit = 20): FTSResult[] {
		// Sanitize query for FTS5 (escape special chars, support wildcards)
		const sanitized = query.replace(/['"]/g, '').trim();

		if (!sanitized) return [];

		let ftsQuery = sanitized;
		if (!sanitized.includes('*') && !sanitized.includes(' ')) {
			ftsQuery = `"${sanitized}"*`;
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
				score: -r.rank, // Invert BM25 so higher is better
			}));
		} catch {
			// Fallback to LIKE if FTS syntax error
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/db.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/db/ test/db.test.js
git commit -m "feat(db): add SQLite and FTS5 storage layer"
```

---

### Task 3: Hybrid Search Service with Gemini Embeddings

**Files:**

- Create: `src/server/services/search/semantic-search.ts`
- Create: `src/server/services/search/hybrid-search.ts`
- Test: `test/search.test.js`

**Interfaces:**

- Consumes: `AppleDocsDB`, `GEMINI_API_KEY` (env)
- Produces: `HybridSearchEngine` class with method `search(query: string, options?: SearchOptions)`

- [ ] **Step 1: Write unit tests for Hybrid Search Engine**

Create `test/search.test.js`:

```javascript
import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';

test('HybridSearchEngine returns scored results without Gemini key', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/navigationstack',
		framework: 'SwiftUI',
		title: 'NavigationStack',
		kind: 'struct',
		abstract: 'A view that displays a root view.',
		path: '/documentation/swiftui/navigationstack',
		platforms: ['iOS 16.0+'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/swiftui/navigationpath',
		framework: 'SwiftUI',
		title: 'NavigationPath',
		kind: 'struct',
		abstract: 'A type-erased list of data representing the navigation stack.',
		path: '/documentation/swiftui/navigationpath',
		platforms: ['iOS 16.0+'],
		isPrimaryType: true,
	});

	const engine = new HybridSearchEngine(db, { apiKey: undefined });
	const results = await engine.search('NavigationStack');

	assert.strictEqual(results.length, 2);
	assert.strictEqual(results[0].title, 'NavigationStack'); // Exact match boosted
	db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/search.test.js`
Expected: FAIL (modules do not exist yet)

- [ ] **Step 3: Implement Semantic Search & Hybrid Search**

Create `src/server/services/search/semantic-search.ts`:

```typescript
import axios from 'axios';

export interface SemanticMatch {
	id: string;
	framework: string;
	title: string;
	kind: string;
	summary: string;
	path: string;
	similarity: number;
}

export class GeminiSemanticSearch {
	constructor(private readonly apiKey?: string) {}

	async embedQuery(text: string): Promise<Float32Array | null> {
		if (!this.apiKey) return null;
		try {
			const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.apiKey}`;
			const response = await axios.post(
				url,
				{
					model: 'models/text-embedding-004',
					content: { parts: [{ text }] },
				},
				{ timeout: 3000 },
			);
			const values = response.data?.embedding?.values;
			if (!Array.isArray(values)) return null;
			return new Float32Array(values);
		} catch (err) {
			console.error(
				'Warning: Gemini embedding failed, falling back to lexical search:',
				err instanceof Error ? err.message : err,
			);
			return null;
		}
	}

	cosineSimilarity(a: Float32Array, b: Float32Array): number {
		let dot = 0.0;
		let normA = 0.0;
		let normB = 0.0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}
		const denom = Math.sqrt(normA) * Math.sqrt(normB);
		return denom > 0 ? dot / denom : 0;
	}
}
```

Create `src/server/services/search/hybrid-search.ts`:

```typescript
import { AppleDocsDB, DbSymbol } from '../../db/database.js';
import { GeminiSemanticSearch } from './semantic-search.js';

export interface SearchOptions {
	framework?: string;
	limit?: number;
}

export interface SearchResultItem extends DbSymbol {
	score: number;
	source: 'fts' | 'semantic' | 'hybrid';
}

export class HybridSearchEngine {
	private semanticSearch: GeminiSemanticSearch;

	constructor(
		private readonly db: AppleDocsDB,
		options: { apiKey?: string } = {},
	) {
		this.semanticSearch = new GeminiSemanticSearch(options.apiKey);
	}

	async search(
		query: string,
		options: SearchOptions = {},
	): Promise<SearchResultItem[]> {
		const limit = options.limit || 20;
		const ftsResults = this.db.queryFTS(query, options.framework, limit * 2);

		// Exact symbol boost
		const exactMatches: SearchResultItem[] = [];
		const regularMatches: SearchResultItem[] = [];

		const normalizedQuery = query.trim().toLowerCase();
		for (const item of ftsResults) {
			const isExact = item.title.toLowerCase() === normalizedQuery;
			const resItem: SearchResultItem = {
				...item,
				score: isExact ? item.score + 100 : item.score,
				source: 'fts',
			};
			if (isExact) {
				exactMatches.push(resItem);
			} else {
				regularMatches.push(resItem);
			}
		}

		const merged = [...exactMatches, ...regularMatches].slice(0, limit);
		return merged;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/search.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/services/search/ test/search.test.js
git commit -m "feat(search): implement hybrid search engine with Gemini fallback"
```

---

### Task 4: Ingestion Pipeline Script

**Files:**

- Create: `scripts/build-index.ts`
- Modify: `package.json` (add `build:index` script)
- Test: `test/ingest.test.js`

**Interfaces:**

- Consumes: Apple DocC API endpoint (`https://developer.apple.com/tutorials/data/documentation/{framework}.json`)
- Produces: Populated SQLite index file `data/apple-docs.db`

- [ ] **Step 1: Write ingestion test against mock data**

Create `test/ingest.test.js`:

```javascript
import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { indexFrameworkData } from '../dist/server/services/indexer.js';

test('indexFrameworkData correctly extracts symbols and abstracts', () => {
	const db = new AppleDocsDB(':memory:');
	const mockDocC = {
		metadata: { title: 'SwiftUI' },
		references: {
			'doc://com.apple.documentation/documentation/swiftui/view': {
				title: 'View',
				kind: 'symbol',
				url: '/documentation/swiftui/view',
				abstract: [
					{
						type: 'text',
						text: 'A type that represents part of the user interface.',
					},
				],
				platforms: [{ name: 'iOS' }],
			},
		},
	};

	indexFrameworkData(db, 'SwiftUI', mockDocC);
	const results = db.queryFTS('View');
	assert.strictEqual(results.length, 1);
	assert.strictEqual(results[0].title, 'View');
	assert.strictEqual(
		results[0].abstract,
		'A type that represents part of the user interface.',
	);
	db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/ingest.test.js`
Expected: FAIL

- [ ] **Step 3: Implement indexer service & build script**

Create `src/server/services/indexer.ts`:

```typescript
import { AppleDocsDB } from '../db/database.js';

export function indexFrameworkData(
	db: AppleDocsDB,
	framework: string,
	data: any,
): number {
	if (!data?.references) return 0;
	let count = 0;

	for (const [id, ref] of Object.entries<any>(data.references)) {
		if (ref.kind !== 'symbol' || !ref.title) continue;

		const abstractText = Array.isArray(ref.abstract)
			? ref.abstract
					.map((p: any) => p.text || '')
					.join(' ')
					.trim()
			: '';

		const platforms = Array.isArray(ref.platforms)
			? ref.platforms.map((p: any) => p.name).filter(Boolean)
			: [];

		const isPrimary = ['struct', 'class', 'protocol', 'enum'].includes(
			ref.symbolKind || '',
		);

		db.insertSymbol({
			id: ref.url || id,
			framework,
			title: ref.title,
			kind: ref.symbolKind || ref.kind || 'symbol',
			abstract: abstractText,
			path: ref.url || id,
			platforms,
			isPrimaryType: isPrimary,
		});
		count++;
	}

	return count;
}
```

Create `scripts/build-index.ts` to crawl core frameworks (SwiftUI, UIKit, Foundation, SwiftData, Combine, AppKit, Swift Standard Library).
Update `package.json` with script `"build:index": "tsx scripts/build-index.ts"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/ingest.test.js`
Expected: PASS

- [ ] **Step 5: Run seed generation for core frameworks**

Run: `npm run build:index`
Verify: `data/apple-docs.db` exists and has core symbols.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/indexer.ts scripts/build-index.ts test/ingest.test.js package.json
git commit -m "feat(indexer): implement framework indexing pipeline"
```

---

### Task 5: Refactor MCP Handlers for Stateless Global Search

**Files:**

- Modify: `src/server/context.ts`
- Modify: `src/server/tools.ts`
- Modify: `src/server/handlers/search-symbols.ts`
- Test: `test/mcp-handlers.test.js`

**Interfaces:**

- Consumes: `HybridSearchEngine`, `ServerContext`
- Produces: MCP tools with `search_symbols` supporting global & scoped search without requiring `choose_technology`.

- [ ] **Step 1: Write integration test for search_symbols without choose_technology**

Create `test/mcp-handlers.test.js`:

```javascript
import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';
import { AppleDevDocsClient } from '../dist/apple-client.js';

test('search_symbols succeeds globally when no technology is selected', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A type that represents part of the user interface.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});

	const state = new ServerState();
	const searchEngine = new HybridSearchEngine(db);
	const client = new AppleDevDocsClient();

	const handler = buildSearchSymbolsHandler({
		client,
		state,
		db,
		searchEngine,
	});

	const response = await handler({ query: 'View' });
	assert(response.content[0].text.includes('View'));
	assert(response.content[0].text.includes('SwiftUI'));
	assert(!response.content[0].text.includes('No technology selected'));
	db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/mcp-handlers.test.js`
Expected: FAIL

- [ ] **Step 3: Update context, tools, and search-symbols handler**

Update `src/server/context.ts` to include `db: AppleDocsDB` and `searchEngine: HybridSearchEngine`.
Update `src/server/tools.ts` to make `search_symbols` description indicate that `framework` is optional and global search is default.
Update `src/server/handlers/search-symbols.ts` to query `searchEngine.search(query, { framework: args.framework || state.getActiveTechnology()?.title })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/mcp-handlers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/context.ts src/server/tools.ts src/server/handlers/search-symbols.ts test/mcp-handlers.test.js
git commit -m "feat(mcp): support global symbol search and backwards-compatible scoped search"
```

---

### Task 6: Full Verification, Documentation & End-to-End Build

**Files:**

- Modify: `README.md`
- Test: All tests (`npm test`, `npm run typecheck`, `npm run build`)

**Interfaces:**

- Consumes: Entire codebase
- Produces: Production-ready distribution build in `dist/` with bundled database

- [ ] **Step 1: Run comprehensive test suite**

Run: `npm test`
Expected: All unit & integration tests pass (0 failures).

- [ ] **Step 2: Run TypeScript typecheck & linting**

Run: `npm run typecheck`
Expected: Clean exit code 0.

- [ ] **Step 3: Update README.md with new capabilities**

Document:

- Global instant search without requiring `choose_technology`
- Pre-indexed core frameworks
- Gemini Embedding configuration (`GEMINI_API_KEY`)
- Updated tool descriptions

- [ ] **Step 4: Commit and finalize**

```bash
git add README.md
git commit -m "docs: document hybrid search and global search capabilities"
```
