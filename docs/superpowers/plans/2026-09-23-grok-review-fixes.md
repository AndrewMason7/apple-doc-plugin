# Grok Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Grok review recommendations: resolve SQLite FTS5 rowid desync, preserve abstracts during index crawl, pin 3072 embedding dimensions, expand circuit breaker coverage to timeouts and 401/403, and validate MCP arguments.

---

### Task 1: Fix SQLite FTS5 Upsert, Abstract Preservation & Safe Deserialization

**Files:**

- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/database.ts`
- Test: `test/fts-integrity.test.js`

- [ ] **Step 1: Write test reproducing FTS5 rowid desync and abstract overwriting**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement upsert with abstract preservation, rebuildFTS(), and byteLength % 4 check**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 2: Circuit Breaker Hardening & Embedding Dimension Pinning

**Files:**

- Modify: `src/server/services/search/semantic-search.ts`
- Test: `test/security-headers.test.js`

- [ ] **Step 1: Write test for timeout and 401/403 circuit breaker tripping and dimension parameter**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement output_dimensionality: 3072 and expanded circuit breaker tripping**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 3: MCP Input Validation & Wildcard Handling

**Files:**

- Modify: `src/server/handlers/search-symbols.ts`
- Modify: `src/server/db/database.ts`
- Test: `test/search.test.js`

- [ ] **Step 1: Write test for clamped maxResults and wildcard queries**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement argument validation and wildcard routing**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 4: Re-index Database & Verify FTS MATCH on Real Corpus

**Files:**

- Modify: `scripts/build-index.ts`
- Test: `test/e2e.test.js`

- [ ] **Step 1: Update build-index.ts to run rebuildFTS() and checkpoint WAL at end of build**
- [ ] **Step 2: Execute build-index to rebuild data/apple-docs.db**
- [ ] **Step 3: Verify non-empty abstracts and FTS MATCH 'View' directly on data/apple-docs.db**
- [ ] **Step 4: Commit**

---

### Task 5: Final Full Suite Verification & Push

- [ ] **Step 1: Run npm run typecheck, npm run build, and npm test**
- [ ] **Step 2: Push commits to remote origin/main**
