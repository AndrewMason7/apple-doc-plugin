# Agent Contract & Index Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the tool contract and index data corruption so coding agents never fail to resolve symbols like `NavigationStack` or `View`, receive copy-paste ready documentation calls, benefit from flexible kind aliases, query true local framework catalogs, and avoid false reranking against 24 landing page images.

**Architecture:**

1. Database resolution layer upgraded with multi-stage fallback: exact path → case-insensitive path → exact title match (`COLLATE NOCASE`) → path suffix match → disambiguation list (or `isError: true` if completely missing).
2. Search result formatter generates ready-to-call `get_documentation({ path, framework })` snippets and exposes kind aliases.
3. Clean separation of Swift standard library rows from Observation, universal wildcard routing to LIKE queries, and a semantic threshold gate that skips RRF when vector counts are trivial (<100 items).

**Tech Stack:** TypeScript 5.8+, Node.js 22+, SQLite FTS5 (`better-sqlite3`), Model Context Protocol SDK.

**Spec:** User audit findings and smoking guns (measured in `data/apple-docs.db` and handlers).

---

## Global Constraints

- Never break offline capability: offline SQLite FTS5 must remain 100% operational without network or API keys.
- Preserve separation of concerns (SoC): database query logic remains in `AppleDocsDB`, HTTP fallback in `AppleDevDocsClient`, tool presentation in handlers.
- Node.js >= 22 compatibility floor.
- Strictly adhere to TDD: write failing test first, verify failure, implement, verify pass, commit.

---

## Review Focus

1. `get_documentation({ path: "NavigationStack" })` or `path: "View"` without prefix or framework must resolve via title and case-insensitive path matching rather than failing into a 40-line `noTechnology` essay.
2. `search_symbols({ query: "interactiveDismissDisabled", symbolType: "func" })` must match methods and instance methods via kind aliases instead of deleting 20,000 methods.
3. Wildcards anywhere in a query (`Grid*`, `*Style`, `Navigation*View`) must route to SQL `LIKE` / globbing without the asterisk being sanitized away.
4. Framework discovery must report actual indexed SQLite frameworks with counts, not live un-indexed Apple catalogs.
5. Search results must explicitly provide the exact runnable tool call: `get_documentation({ "path": "...", "framework": "..." })`.

---

## Proposed Changes & Task Decomposition

### Task 1: Title & Fuzzy Path Resolution in `AppleDocsDB` and `get_documentation`

**Files:**

- Modify: `src/server/db/database.ts`
- Modify: `src/server/handlers/get-documentation.ts`
- Modify: `src/server/services/symbol-resolution.ts`
- Test: `test/get-documentation-resolution.test.js`

**Interfaces:**

- Consumes: `AppleDocsDB`, `AppleDevDocsClient`
- Produces: `db.resolveSymbol(pathOrTitle: string, framework?: string): { symbol?: DbSymbol; candidates?: DbSymbol[] }`

- [ ] **Step 1: Write failing tests for title, case-insensitive, and disambiguation resolution**
      Create `test/get-documentation-resolution.test.js` asserting that:
  - `resolveSymbol("NavigationStack")` finds `/documentation/swiftui/navigationstack` via title/path.
  - `resolveSymbol("View", "SwiftUI")` resolves `/documentation/swiftui/view`.
  - Calling `get_documentation({ path: "NavigationStack" })` without framework returns the documentation without throwing `noTechnology()`.
  - Unresolvable symbols return `isError: true` starting with `UNRESOLVED:`.

- [ ] **Step 2: Run test to verify it fails**
      Run: `node --test test/get-documentation-resolution.test.js`
      Expected: FAIL (cannot resolve "NavigationStack" by title or short name).

- [ ] **Step 3: Implement multi-stage resolution in `AppleDocsDB` and update `get-documentation.ts`**
  - Add `resolveSymbol(pathOrTitle: string, framework?: string)` in `src/server/db/database.ts`:
    1. Exact path / ID (`path = ? OR id = ?`).
    2. Case-insensitive path match (`path = ? COLLATE NOCASE`).
    3. Normalized path (`/documentation/<framework>/<path>`).
    4. Exact title match (`title = ? COLLATE NOCASE`), scoped by framework if provided.
    5. Path suffix match (`path LIKE '%/' || ? COLLATE NOCASE`).
    6. If multiple hits found, return `candidates` array.
  - Update `src/server/handlers/get-documentation.ts`:
    - Check `db.resolveSymbol(...)` first.
    - If multiple candidates, return a disambiguation list with runnable tool calls instead of 404.
    - If not found in local db, attempt Apple CDN with lowercase normalized path (`documentation/${framework.toLowerCase()}/${symbol.toLowerCase()}`).
    - If unresolved, return `isError: true` with text starting with `UNRESOLVED: Could not find documentation for "${path}"` and concrete suggestions.

- [ ] **Step 4: Run test to verify it passes**
      Run: `node --test test/get-documentation-resolution.test.js`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/database.ts src/server/handlers/get-documentation.ts src/server/services/symbol-resolution.ts test/get-documentation-resolution.test.js
git commit -m "feat(doc): add title and fuzzy path resolution with disambiguation and error flags"
```

---

### Task 2: Search Result Snippets with Copy-Paste Invocations

**Files:**

- Modify: `src/server/handlers/search-symbols.ts`
- Test: `test/search-snippet.test.js`

**Interfaces:**

- Consumes: `SearchResultItem`
- Produces: formatted search markdown including `• **Doc Call:** \`get_documentation({ "path": "...", "framework": "..." })\``

- [ ] **Step 1: Write failing test for copy-paste invocation in search results**
      Create `test/search-snippet.test.js` asserting that formatted search results contain:
  - `path:` with backticks
  - `get_documentation({ "path": ..., "framework": ... })` invocation string

- [ ] **Step 2: Run test to verify it fails**
      Run: `node --test test/search-snippet.test.js`
      Expected: FAIL.

- [ ] **Step 3: Update `formatMatch` in `src/server/handlers/search-symbols.ts`**
      Include:

```ts
`   • **Path:** \`${match.path}\``,
`   • **Doc Call:** \`get_documentation({ "path": "${match.path}"${fwArg} })\``,
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `node --test test/search-snippet.test.js`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/handlers/search-symbols.ts test/search-snippet.test.js
git commit -m "feat(search): include runnable get_documentation invocation in search results"
```

---

### Task 3: Kind Aliases & Non-Destructive Filtering

**Files:**

- Modify: `src/server/handlers/search-symbols.ts`
- Test: `test/kind-aliases.test.js`

**Interfaces:**

- Consumes: `symbolType` string
- Produces: mapped kinds array (`KIND_ALIASES`), graceful fallback if 0 matches

- [ ] **Step 1: Write failing test for `symbolType: "func"` matching methods**
      Create `test/kind-aliases.test.js` testing that:
  - `symbolType: "func"` matches `method` and `func` symbols.
  - When a kind filter matches 0 items, all hits are retained with a fallback notice instead of wiping out results.

- [ ] **Step 2: Run test to verify it fails**
      Run: `node --test test/kind-aliases.test.js`
      Expected: FAIL.

- [ ] **Step 3: Implement `KIND_ALIASES` in `src/server/handlers/search-symbols.ts`**
  - Map `func`/`function` -> `['func', 'method', 'function', 'typeMethod', 'instanceMethod', 'operator']`
  - Map `property`/`var` -> `['property', 'var', 'variable', 'typeProperty', 'instanceProperty']`
  - Map `type` -> `['struct', 'class', 'enum', 'protocol', 'typealias']`
  - If kind filter produces 0 results, retain original results and prepend note: `(Kind filter "${symbolType}" matched 0 symbols; showing all kinds)`.

- [ ] **Step 4: Run test to verify it passes**
      Run: `node --test test/kind-aliases.test.js`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/handlers/search-symbols.ts test/kind-aliases.test.js
git commit -m "feat(search): map kind aliases and prevent empty results on strict kind filter"
```

---

### Task 4: Decouple Sticky Session Scope from Search

**Files:**

- Modify: `src/server/handlers/search-symbols.ts`
- Modify: `src/server/handlers/discover.ts`
- Test: `test/session-scope.test.js`

**Interfaces:**

- Consumes: `args.framework`
- Produces: Global search across all frameworks unless `args.framework` is explicitly provided

- [ ] **Step 1: Write failing test verifying search is global by default even if choose_technology was previously called**
      Create `test/session-scope.test.js` setting active technology to "AppKit", then searching "NavigationStack" without framework argument. Assert results from SwiftUI are returned.

- [ ] **Step 2: Run test to verify it fails**
      Run: `node --test test/session-scope.test.js`
      Expected: FAIL (search was restricted to AppKit).

- [ ] **Step 3: Modify `search-symbols.ts` to ignore sticky session framework by default**
      Change `targetFramework = args.framework || undefined;`.
      In `discover.ts`, update guidance to state: "Pass `framework` directly to tool calls. Session scoping is optional."

- [ ] **Step 4: Run test to verify it passes**
      Run: `node --test test/session-scope.test.js`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/handlers/search-symbols.ts src/server/handlers/discover.ts test/session-scope.test.js
git commit -m "fix(search): decouple global search from sticky session framework"
```

---

### Task 5: Database-Backed Framework Discovery with Exact Symbol Counts

**Files:**

- Modify: `src/server/db/database.ts`
- Modify: `src/server/handlers/discover.ts`
- Test: `test/discover-counts.test.js`

**Interfaces:**

- Consumes: `symbols` table
- Produces: `db.getFrameworkSymbolCounts(): Array<{ framework: string; count: number }>`

- [ ] **Step 1: Write failing test for database-backed framework discovery with symbol counts**
      Create `test/discover-counts.test.js` asserting that `discover_technologies` displays indexed frameworks with exact symbol counts, and valid JSON pagination/examples.

- [ ] **Step 2: Run test to verify it fails**
      Run: `node --test test/discover-counts.test.js`
      Expected: FAIL.

- [ ] **Step 3: Implement `getFrameworkSymbolCounts()` and update `discover.ts`**
  - Query local database for framework counts.
  - Present indexed frameworks first with exact counts.
  - Format pagination and examples with valid tool JSON: `discover_technologies({ "query": "...", "page": 2 })`.

- [ ] **Step 4: Run test to verify it passes**
      Run: `node --test test/discover-counts.test.js`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/database.ts src/server/handlers/discover.ts test/discover-counts.test.js
git commit -m "feat(discover): display indexed frameworks with exact database symbol counts"
```

---

### Task 6: Segregate Swift Standard Library from Observation in Database & Ingest

**Files:**

- Modify: `scripts/build-index.ts`
- Modify: `src/server/services/indexer.ts`
- Modify: `data/apple-docs.db` (re-tag foreign rows)
- Test: `test/observation-integrity.test.js`

**Interfaces:**

- Consumes: `symbols` table in `data/apple-docs.db`
- Produces: Clean Observation framework (~36 actual symbols) and Swift stdlib tagged as `Swift`

- [ ] **Step 1: Write test verifying Observation framework only contains `/documentation/observation/` symbols**
      Create `test/observation-integrity.test.js` asserting:
  - `SELECT count(*) FROM symbols WHERE framework = 'Observation' AND path NOT LIKE '/documentation/observation/%'` equals 0.
  - Searching "Observable" in Observation returns Observation APIs, not `Bool.toggle()`.

- [ ] **Step 2: Run test to verify it fails**
      Run: `node --test test/observation-integrity.test.js`
      Expected: FAIL (18,440 foreign symbols present in Observation).

- [ ] **Step 3: Execute migration script on `data/apple-docs.db` and update indexer filter**
  - Update `data/apple-docs.db`:
    ```sql
    UPDATE symbols SET framework = 'Swift' WHERE framework = 'Observation' AND (path LIKE '/documentation/swift/%' OR id LIKE 'documentation/swift/%');
    UPDATE symbols SET framework = 'Synchronization' WHERE framework = 'Observation' AND (path LIKE '/documentation/synchronization/%' OR id LIKE 'documentation/synchronization/%');
    ```
  - In `src/server/services/indexer.ts` and `scripts/build-index.ts`: ensure ingested child references enforce `framework` matching path prefix.

- [ ] **Step 4: Run test to verify it passes**
      Run: `node --test test/observation-integrity.test.js`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/apple-docs.db scripts/build-index.ts src/server/services/indexer.ts test/observation-integrity.test.js
git commit -m "fix(db): segregate Swift standard library from Observation framework"
```

---

### Task 7: Semantic Search Threshold Guard (< 100 Vectors)

**Files:**

- Modify: `src/server/services/search/hybrid-search.ts`
- Modify: `src/server/handlers/search-symbols.ts`
- Test: `test/semantic-guard.test.js`

**Interfaces:**

- Consumes: `db.getSemanticItemCount()`
- Produces: Bypasses RRF when vector corpus is trivial (<100 items), logging clear status banner

- [ ] **Step 1: Write failing test verifying RRF is skipped when semantic items < 100**
      Create `test/semantic-guard.test.js` testing that with only 24 items in `semantic_items`, `HybridSearchEngine.search` does not let a low-confidence media preview demote an exact FTS5 hit.

- [ ] **Step 2: Run test to verify it fails**
      Run: `node --test test/semantic-guard.test.js`
      Expected: FAIL.

- [ ] **Step 3: Implement threshold check in `HybridSearchEngine`**
      If `this.db.getSemanticItemCount() < 100`, skip RRF fusion and return scored FTS results with notice: `Search Mode: Lexical fallback (semantic index has ${count} items; symbol embeddings require build:index)`.

- [ ] **Step 4: Run test to verify it passes**
      Run: `node --test test/semantic-guard.test.js`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/search/hybrid-search.ts src/server/handlers/search-symbols.ts test/semantic-guard.test.js
git commit -m "feat(search): guard RRF fusion when semantic vector index is below threshold"
```

---

### Task 8: Universal Wildcard Globbing in `queryFTS`

**Files:**

- Modify: `src/server/db/database.ts`
- Test: `test/wildcards.test.js`

**Interfaces:**

- Consumes: Any query containing `*` or `?`
- Produces: SQL `LIKE` pattern matching without stripping wildcard characters

- [ ] **Step 1: Write failing tests for `Grid*` and `Navigation*View` globbing**
      Add test cases in `test/wildcards.test.js` asserting `Grid*` and `Navigation*View` properly match symbols with wildcards anywhere in the string.

- [ ] **Step 2: Run test to verify it fails**
      Run: `node --test test/wildcards.test.js`
      Expected: FAIL for `Navigation*View` (was treated as AND query).

- [ ] **Step 3: Update `queryFTS` in `src/server/db/database.ts`**
      If `trimmed.includes('*') || trimmed.includes('?')`:

```ts
const pattern = trimmed
	.replace(/\*/g, '%')
	.replace(/\?/g, '_')
	.replace(/["']/g, '');
return this.queryLikePattern(pattern, framework, limit);
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `node --test test/wildcards.test.js`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/database.ts test/wildcards.test.js
git commit -m "fix(db): route all wildcard queries to SQL pattern matching without sanitization loss"
```

---

### Task 9: Full Regression, Prettier Formatting, & README Synchronization

**Files:**

- Modify: `README.md`
- Modify: `rules/AGENTS.md`
- Modify: `skills/apple-docs/SKILL.md`

- [ ] **Step 1: Run complete test suite and linters**
      Run: `npm run check && npm test`
      Verify: 100% pass across all tests.

- [ ] **Step 2: Update documentation to reflect exact resolution behavior and kind aliases**
      Update `README.md`, `rules/AGENTS.md`, and `SKILL.md`.

- [ ] **Step 3: Commit**

```bash
git add README.md rules/AGENTS.md skills/apple-docs/SKILL.md
git commit -m "docs: sync README, rules, and skill with enhanced resolution contract"
```

---

## Verification Plan

### Automated Tests

```bash
npm run check
npm test
```

All new and existing tests must pass with zero failures.

### Manual Verification

1. Run `node dist/index.js` via stdio client or MCP inspector.
2. Call `get_documentation({ path: "NavigationStack" })` without framework → resolves `NavigationStack` documentation directly from local database.
3. Call `get_documentation({ path: "View" })` → returns disambiguation list with copy-paste calls for SwiftUI, UIKit, AppKit.
4. Call `search_symbols({ query: "interactiveDismissDisabled", symbolType: "func" })` → returns `interactiveDismissDisabled(Bool)` method.
5. Call `discover_technologies({})` → lists actual indexed frameworks with symbol counts (e.g. Observation: 36, SwiftUI: 7,205).
