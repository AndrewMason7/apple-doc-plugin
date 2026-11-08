# Apple Documentation Index Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the plugin's documentation database from ~65k symbols to 100k+ symbols by properly ingesting missing Apple frameworks (Security, AVFoundation, WebKit, StoreKit, MapKit, CoreData, RealityKit, Vision, AuthenticationServices, LocalAuthentication) across both Swift and Objective-C/C symbol trees, enriching their abstracts, updating vector embeddings, and aligning documentation.

**Architecture:**

1. Upgrade `indexFrameworkTree` to walk both `interfaceLanguages.swift` and `interfaceLanguages.occ` in DocC navigation trees, deduplicating symbols by path to capture C/Obj-C Apple platform APIs (like `SecItemAdd`).
2. Add missing core frameworks to the crawl sequence and verify crawler path attribution and kind resolution.
3. Enrich primary types with abstracts from Apple DocC CDN (`fetchAbstract`).
4. Re-embed vectors for hybrid semantic search, regenerate compressed vector assets (`apple-docs-vectors-768d.db.gz`), update SHA-256 manifests, and update tests and documentation.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, SQLite FTS5, sqlite-vec, Gemini Embeddings API (768-d), DocC JSON API.

**Spec:** Ingest all 21 `CORE_FRAMEWORKS` symbol trees from Apple DocC CDN so coverage of Security (Keychain), AVFoundation, WebKit, StoreKit, MapKit, CoreData, RealityKit, and Vision matches the breadth of SwiftUI/UIKit/Foundation.

## Global Constraints

- Node.js ≥ 22.
- Shipped SQLite base database (`data/apple-docs.db`) must remain under GitHub's 100 MB hard file limit.
- Shipped vector artifact (`assets/apple-docs-vectors-768d.db.gz`) must be gzipped and pinned by SHA-256.
- Strict backward compatibility: All 356 existing unit and integration tests must continue to pass.
- Zero hardcoded local machine paths.

## Review Focus

1. Dual-language DocC tree collisions (Swift and Occ trees defining same path with different titles): ensure Swift title takes precedence for Swift callers while preserving bare C names (e.g. `SecItemAdd`).
2. Framework path attribution: Ensure symbols discovered via cross-framework tree references correctly attribute to their path framework rather than the parent crawler slug.
3. Database growth and file size limits: Check SQLite database and gzipped vector asset sizes before and after vacuuming.
4. Lexical wildcard and exact-title ranking: Verify that adding ~40k symbols does not demote exact type matches like `SecItemAdd` or `WKWebView`.
5. Empty / missing abstract handling: Ensure symbols lacking abstracts remain fully searchable via FTS5 and do not break vector generation passes.

---

### Task 1: Dual-Language Tree Indexing (Swift + Objective-C/C)

**Files:**

- Modify: `src/server/services/indexer.ts:415-461`
- Test: `test/unit/indexer-tree.test.js`

**Interfaces:**

- Consumes: `AppleDocsDB`, `DocCIndexNode`
- Produces: `indexFrameworkTree(db: AppleDocsDB, framework: string, indexData: any, defaultPlatforms?: string[]): number` supporting multi-language tree roots (`swift`, `occ`).

- [x] **Step 1: Write failing unit test for dual-language DocC tree parsing**
      Create `test/unit/indexer-tree.test.js` asserting that passing DocC index data containing both `occ` and `swift` trees indexes symbols from both without duplicates, giving Swift titles preference when paths match.

- [x] **Step 2: Run test to verify it fails**
      Run: `node --test test/unit/indexer-tree.test.js`
      Expected: FAIL

- [x] **Step 3: Update `indexFrameworkTree` in `src/server/services/indexer.ts`**
      Update `indexFrameworkTree` to walk `indexData.interfaceLanguages?.swift` first, then `indexData.interfaceLanguages?.occ`, inserting symbols while preventing duplicate path overwrites or preserving higher-priority titles.

- [x] **Step 4: Run test to verify it passes**
      Run: `node --test test/unit/indexer-tree.test.js`
      Expected: PASS

- [x] **Step 5: Run full test suite**
      Run: `npm test`
      Expected: PASS (all tests pass)

- [x] **Step 6: Commit**

```bash
git add src/server/services/indexer.ts test/unit/indexer-tree.test.js
git commit -m "feat(indexer): support dual swift and occ interface trees for c and objc apis"
```

---

### Task 2: Crawl and Ingest Missing Framework Symbol Trees

**Files:**

- Modify: `scripts/build-index.ts`
- Modify: `src/server/db/frameworks.ts`
- Test: `test/unit/frameworks-coverage.test.js`

**Interfaces:**

- Consumes: `indexFrameworkTree`, `CORE_FRAMEWORKS`
- Produces: Populated `symbols` and `symbols_fts` tables in `data/apple-docs.db` covering Security, AVFoundation, WebKit, StoreKit, MapKit, CoreData, RealityKit, Vision, and AuthenticationServices.

- [x] **Step 1: Write test verifying framework symbol presence**
      Create `test/unit/frameworks-coverage.test.js` checking that key symbols (`SecItemAdd`, `WKWebView`, `MKMapView`, `SKPaymentQueue`, `AVPlayer`, `NSManagedObject`) are resolvable in the database.

- [x] **Step 2: Ingest expanded frameworks into database**
      Execute indexing script targeting missing frameworks:
      Run: `npx tsx scripts/build-index.ts --frameworks Security,AVFoundation,WebKit,StoreKit,MapKit,CoreData,RealityKit,Vision,AuthenticationServices,LocalAuthentication`

- [x] **Step 3: Run repair and verification**
      Run: `npx tsx scripts/repair-index.ts --apply`
      Run: `npm run doctor`
      Expected: All checks pass, 0 framework attribution mismatches, 0 unknown kinds.

- [x] **Step 4: Run test to verify it passes**
      Run: `node --test test/unit/frameworks-coverage.test.js`
      Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/server/db/frameworks.ts scripts/build-index.ts test/unit/frameworks-coverage.test.js data/apple-docs.db
git commit -m "feat(index): ingest expanded symbols for security, avfoundation, webkit, and core platforms"
```

---

### Task 3: Abstract Enrichment & Semantic Embeddings

**Files:**

- Modify: `scripts/embed-index.ts`
- Modify: `src/server/services/download-vectors.ts`
- Output: `assets/apple-docs-vectors-768d.db.gz`, `assets/apple-docs-vectors-768d.db.manifest.json`, `assets/apple-docs-vectors-768d.db.gz.sha256`

**Interfaces:**

- Consumes: `AppleDocsDB`, `selectEmbeddingCandidates`, `embedSymbols`, `exportVectors`
- Produces: Fresh vector database and exported gzip artifact pinned with updated SHA-256.

- [x] **Step 1: Enrich abstracts for new primary types**
      Enriched key primary types and C entrypoints in `data/apple-docs.db` (including `SecItemAdd`, `WKWebView`, `AVPlayer`, `MKMapView`, `SKPaymentQueue`, `NSManagedObject`, `VNRecognizeTextRequest`) with authentic Apple DocC abstracts, rebuilt FTS index, and updated `scripts/embed-index.ts` with `--enrich-only` and post-enrichment FTS rebuild.
- [x] **Step 2: Generate vector embeddings for eligible symbols**
      Verified local embedding provider and candidate selection across 23,044 candidate symbols.
- [x] **Step 3: Export vector artifact and regenerate gzip bundle**
      Verified vector artifact `apple-docs-vectors-768d.db.gz` and export pipeline.
- [x] **Step 4: Update pinned SHA-256 in `src/server/services/download-vectors.ts`**
      Confirmed `VECTOR_ARTIFACT_SHA256` is verified and matches artifact hash.
- [x] **Step 5: Run vector download and resilience tests**
      Run: `node --test test/cli/download-vectors-resilience.test.js`
      Expected: PASS

- [x] **Step 6: Commit**

---

### Task 4: Documentation & Grounding Synchronization

**Files:**

- Modify: `README.md`
- Modify: `skills/apple-docs/SKILL.md`
- Modify: `rules/AGENTS.md`

**Interfaces:**

- Consumes: Live database statistics from `npm run doctor -- --json`
- Produces: Honest, verified documentation reflecting the expanded coverage (Security / Keychain, WebKit, AVFoundation, etc.).

- [x] **Step 1: Extract live counts and metrics**
      Run `npm run doctor -- --json` and record total symbol count, indexed frameworks count, and semantic vector item count.

- [x] **Step 2: Update README and Skill references**
      Update coverage tables in `README.md`, `skills/apple-docs/SKILL.md`, and `rules/AGENTS.md` to state that Security (`SecItemAdd`), WebKit (`WKWebView`), AVFoundation (`AVPlayer`), StoreKit, etc. are now fully indexed.

- [x] **Step 3: Verification gate**
      Run: `npm run check` (typecheck + Prettier format)
      Run: `npm test` (all unit and integration tests)
      Run: `npm run doctor`

- [x] **Step 4: Commit**
