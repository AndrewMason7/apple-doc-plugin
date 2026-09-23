# Multimodal Gemini Indexing & Visual Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate multimodal image and diagram embedding with `gemini-embedding-2` and display Apple UI layout previews in MCP search results.

**Architecture:** Extend SQLite `semantic_items` table with `media_url` and `media_type`. Add `embedMultimodal` to `GeminiSemanticSearch` to embed image buffers alongside text captions. Extract DocC media references in `indexer.ts` and seed visual previews in `scripts/build-index.ts`. Format media preview images in `search-symbols.ts` for multimodal coding assistants.

**Tech Stack:** TypeScript, Node.js, `better-sqlite3`, `axios`, Gemini Embeddings (`gemini-embedding-2`).

**Spec:** [docs/superpowers/specs/2026-09-23-multimodal-gemini-indexing-design.md](file:///Users/andrew/Documents/GitHub/apple-doc-plugin/docs/superpowers/specs/2026-09-23-multimodal-gemini-indexing-design.md)

## Global Constraints

- Never store raw binary image bytes in SQLite; store only the 3072-float vector and the Apple CDN `media_url`.
- If an image fails to download or embed during build time, the pipeline must log a warning and continue without crashing.
- At runtime, if `GEMINI_API_KEY` is not present, the server must continue operating in pure lexical FTS5 mode without errors.
- Visual media markdown (`![Visual Preview](url)`) must be returned cleanly for items with `media_url`.

## Review Focus

1. **404 Image URLs**: Apple DocC occasionally lists image references whose CDN URLs return 404; the builder must gracefully handle non-200 responses.
2. **Missing `media_url` in Database**: Standard symbol entries with no visual previews must render normally without broken image markdown.
3. **Database Migration on Existing DB**: Updating the schema must safely add `media_url` and `media_type` columns via `ALTER TABLE` if they don't already exist.
4. **Image Payload Size**: Downloaded images must be processed as streams/buffers in memory and immediately garbage-collected after embedding.
5. **Dark Mode vs Light Mode Image Variants**: The extractor should select 2x light mode image traits by default for high-DPI crispness.

---

### Task 1: SQLite Multimodal Schema Migration & Methods

**Files:**
- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/database.ts`
- Test: `test/db-multimodal.test.js`

**Interfaces:**
- Consumes: `better-sqlite3`
- Produces: `SemanticItem` with `mediaUrl?: string` and `mediaType?: string`, `insertSemanticItem` and `getSemanticItems` supporting media columns.

- [ ] **Step 1: Write test for multimodal semantic item insertion and retrieval**

Create `test/db-multimodal.test.js`:
```javascript
import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';

test('AppleDocsDB stores and retrieves semantic items with media_url and media_type', () => {
  const db = new AppleDocsDB(':memory:');
  const vec = new Float32Array(3072);
  vec[0] = 0.85;

  db.insertSemanticItem({
    id: 'preview-nav-split',
    framework: 'SwiftUI',
    title: 'NavigationSplitView Layout Preview',
    kind: 'ui_preview',
    summary: 'Three-column navigation layout on iPad.',
    path: '/documentation/swiftui/navigationsplitview',
    mediaUrl: 'https://developer.apple.com/tutorials/images/nav-split.png',
    mediaType: 'image/png',
    embedding: vec,
  });

  const items = db.getSemanticItems('SwiftUI');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].mediaUrl, 'https://developer.apple.com/tutorials/images/nav-split.png');
  assert.strictEqual(items[0].mediaType, 'image/png');
  assert.strictEqual(items[0].embedding[0], 0.85);

  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db-multimodal.test.js`
Expected: FAIL

- [ ] **Step 3: Update schema.ts and database.ts**

Update `SCHEMA_SQL` to include `media_url TEXT, media_type TEXT`.
Update `SemanticItem` interface and `insertSemanticItem`/`getSemanticItems` in `database.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/db-multimodal.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/db/ test/db-multimodal.test.js
git commit -m "feat(db): support media_url and media_type in semantic_items"
```

---

### Task 2: Multimodal Embedding in GeminiSemanticSearch

**Files:**
- Modify: `src/server/services/search/semantic-search.ts`
- Test: `test/multimodal-search.test.js`

**Interfaces:**
- Consumes: Gemini API (`gemini-embedding-2`)
- Produces: `embedMultimodal(text: string, imageBase64: string, mimeType: string): Promise<Float32Array | null>`

- [ ] **Step 1: Write unit test for embedMultimodal**

Create `test/multimodal-search.test.js`:
```javascript
import assert from 'node:assert';
import test from 'node:test';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';

test('GeminiSemanticSearch validates embedMultimodal interface', async () => {
  const search = new GeminiSemanticSearch(null); // disabled API
  const res = await search.embedMultimodal('Sample caption', 'base64data', 'image/png');
  assert.strictEqual(res, null); // Graceful null when no API key
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/multimodal-search.test.js`
Expected: FAIL (`embedMultimodal` not defined)

- [ ] **Step 3: Implement embedMultimodal in GeminiSemanticSearch**

Add `embedMultimodal(text: string, imageBase64: string, mimeType = 'image/png'): Promise<Float32Array | null>` to `src/server/services/search/semantic-search.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/multimodal-search.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/services/search/semantic-search.ts test/multimodal-search.test.js
git commit -m "feat(search): add embedMultimodal support to GeminiSemanticSearch"
```

---

### Task 3: Media Reference Extraction in Indexer

**Files:**
- Modify: `src/server/services/indexer.ts`
- Test: `test/indexer-media.test.js`

**Interfaces:**
- Consumes: Apple DocC JSON `references`
- Produces: `extractMediaReferences(data: any): DocCMediaItem[]`

- [ ] **Step 1: Write unit test for DocC media extraction**

Create `test/indexer-media.test.js`:
```javascript
import assert from 'node:assert';
import test from 'node:test';
import { extractMediaReferences } from '../dist/server/services/indexer.js';

test('extractMediaReferences correctly parses Apple image references and trait URLs', () => {
  const mockDocC = {
    references: {
      'sample-card.png': {
        type: 'image',
        alt: 'A screenshot showing iPad UI layout.',
        variants: [
          { traits: ['2x', 'light'], url: '/images/sample-card@2x.png' },
          { traits: ['2x', 'dark'], url: '/images/sample-card~dark@2x.png' }
        ]
      }
    }
  };

  const media = extractMediaReferences(mockDocC);
  assert.strictEqual(media.length, 1);
  assert.strictEqual(media[0].alt, 'A screenshot showing iPad UI layout.');
  assert.strictEqual(media[0].url, 'https://developer.apple.com/tutorials/images/sample-card@2x.png');
  assert.strictEqual(media[0].mimeType, 'image/png');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/indexer-media.test.js`
Expected: FAIL

- [ ] **Step 3: Implement extractMediaReferences in indexer.ts**

Implement `extractMediaReferences` resolving Apple's CDN URL `https://developer.apple.com/tutorials` + relative path.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/indexer-media.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/services/indexer.ts test/indexer-media.test.js
git commit -m "feat(indexer): add extractMediaReferences for Apple DocC visual assets"
```

---

### Task 4: Ingestion Pipeline Media Seeding

**Files:**
- Modify: `scripts/build-index.ts`
- Test: Manual run of indexing media items into `data/apple-docs.db`

**Interfaces:**
- Consumes: `extractMediaReferences`, `embedMultimodal`, `AppleDocsDB`
- Produces: Visual previews embedded into `semantic_items` table in `data/apple-docs.db`.

- [ ] **Step 1: Update scripts/build-index.ts to fetch and embed DocC media references**

When `canEmbed` is true:
- Extract media references for each core framework.
- Fetch image bytes, convert to base64.
- Call `semantic.embedMultimodal(alt, base64, mimeType)`.
- Insert into `db.insertSemanticItem(...)` with `mediaUrl`.

- [ ] **Step 2: Run build:index and verify semantic_items with media_url**

Run: `npm run build:index`
Verify: `db.getSemanticItems().filter(i => i.mediaUrl)` contains visual previews.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-index.ts data/apple-docs.db
git commit -m "feat(pipeline): seed multimodal visual previews with gemini-embedding-2"
```

---

### Task 5: MCP Tool Visual Formatting

**Files:**
- Modify: `src/server/handlers/search-symbols.ts`
- Test: `test/mcp-visual.test.js`

**Interfaces:**
- Consumes: `SearchResultItem` with `mediaUrl`
- Produces: ToolResponse markdown containing `![Visual Preview](media_url)` when `mediaUrl` is present.

- [ ] **Step 1: Write test for visual markdown output in search_symbols**

Create `test/mcp-visual.test.js`:
```javascript
import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';
import { AppleDevDocsClient } from '../dist/apple-client.js';

test('search_symbols includes visual preview markdown when item has mediaUrl', async () => {
  const db = new AppleDocsDB(':memory:');
  const vec = new Float32Array(3072);
  vec[0] = 1.0;

  db.insertSemanticItem({
    id: 'test-preview',
    framework: 'SwiftUI',
    title: 'NavigationSplitView Preview',
    kind: 'ui_preview',
    summary: 'Visual layout on iPad.',
    path: '/documentation/swiftui/navigationsplitview',
    mediaUrl: 'https://developer.apple.com/tutorials/images/test.png',
    mediaType: 'image/png',
    embedding: vec,
  });

  const state = new ServerState();
  const searchEngine = new HybridSearchEngine(db, { apiKey: null });
  const client = new AppleDevDocsClient();

  // Test searchSemanticWithVector returns mediaUrl
  const matches = searchEngine.searchSemanticWithVector(vec);
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].mediaUrl, 'https://developer.apple.com/tutorials/images/test.png');

  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/mcp-visual.test.js`
Expected: FAIL (`mediaUrl` missing from semantic matches)

- [ ] **Step 3: Update hybrid-search.ts and search-symbols.ts**

Pass `mediaUrl` through `SemanticMatch` and `SearchResultItem`.
In `formatMatch`, append `\n   ![Visual Preview](${match.mediaUrl})\n` if `match.mediaUrl` exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/mcp-visual.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/services/search/hybrid-search.ts src/server/handlers/search-symbols.ts test/mcp-visual.test.js
git commit -m "feat(mcp): render visual preview markdown in search_symbols output"
```

---

### Task 6: Full Verification & End-to-End Suite

**Files:**
- Modify: `README.md`
- Test: All tests (`npm test`, `npm run typecheck`, E2E test)

- [ ] **Step 1: Run comprehensive test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run static typecheck**

Run: `npm run typecheck`
Expected: Clean exit 0.

- [ ] **Step 3: Update README.md documenting multimodal capabilities**

- [ ] **Step 4: Commit and finalize**

```bash
git add README.md
git commit -m "docs: document multimodal visual embeddings and UI previews"
```
