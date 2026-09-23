# Hardened Security, Memory Safety & Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement tribunal findings: eliminate API credential exposure in URLs, fix buffer alignment safety, cache vectors with pre-computed L2 norms, sanitize FTS5/LIKE queries, and add circuit breakers.

**Architecture:** Transmit `x-goog-api-key` in HTTP headers. In `database.ts`, use an aligned `ArrayBuffer` copy for `Float32Array` deserialization, cache loaded vectors, and sanitize search queries. Implement circuit breaker in `GeminiSemanticSearch`.

**Tech Stack:** TypeScript, Node.js, `better-sqlite3`, `axios`.

**Spec:** [docs/superpowers/specs/2026-09-23-hardened-security-and-perf-refactor-design.md](file:///Users/andrew/Documents/GitHub/apple-doc-plugin/docs/superpowers/specs/2026-09-23-hardened-security-and-perf-refactor-design.md)

## Global Constraints

- Never pass `apiKey` in URL query parameters.
- `Float32Array` creation must never fail on unaligned `byteOffset`.
- FTS5 queries must never crash on special characters like `(`, `)`, `:`, `"`, `^`.
- Zero disk-scan on repeated semantic vector searches; load once into cache.

## Review Focus

1. **HTTP Error Logging with Redacted Key**: When Axios throws an error on network failure, `err.config.url` must NOT contain the API key.
2. **Buffer Alignment**: `byteOffset % 4 !== 0` must deserialize cleanly into `Float32Array`.
3. **FTS5 Syntax Characters**: Queries like `View (SwiftUI) : *` must execute without throwing SQLite syntax errors.
4. **Corrupted JSON Platforms**: Rows with malformed `platforms` strings must not crash `queryFTS`.
5. **Circuit Breaker Recovery**: When circuit breaker trips, search must instantly fall back to FTS5 without blocking for 4 seconds.

---

### Task 1: Security & Credential Hygiene in GeminiSemanticSearch

**Files:**
- Modify: `src/server/services/search/semantic-search.ts`
- Test: `test/security-headers.test.js`

- [ ] **Step 1: Write test verifying header-based auth and circuit breaker**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement header auth and circuit breaker in semantic-search.ts**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 2: Memory Alignment, Vector Cache & Sanitization in Database Layer

**Files:**
- Modify: `src/server/db/database.ts`
- Test: `test/db-hardened.test.js`

- [ ] **Step 1: Write test for unaligned buffer, vector cache, and FTS sanitization**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement fixes in database.ts**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 3: Vector Norm Optimization in Hybrid Search Engine

**Files:**
- Modify: `src/server/services/search/hybrid-search.ts`
- Test: `test/search.test.js`

- [ ] **Step 1: Update hybrid-search.ts to use pre-computed norms**
- [ ] **Step 2: Run test to verify it passes**
- [ ] **Step 3: Commit**

---

### Task 4: Tribunal Adversarial Stress Test Suite & Final Build

**Files:**
- Create: `test/stress-tribunal.test.js`
- Test: All tests (`npm test`, `npm run typecheck`, `npm run build`)

- [ ] **Step 1: Write comprehensive adversarial stress tests**
- [ ] **Step 2: Run all tests to verify 100% green**
- [ ] **Step 3: Commit and finalize**
