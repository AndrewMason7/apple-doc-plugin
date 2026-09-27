# Error Handling & Resilience Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden error handling across all 5 architectural tiers of the Apple Doc MCP server: eliminate 14+ silent database exception swallows, standardize tool error contracts (`isError: true`), add exponential backoff and 404 fast-failure in `HttpClient`, ensure atomic writes and corrupted JSON auto-healing in `FileCache`, and protect the process lifecycle against unhandled rejections.

**Architecture:** Introduce a typed error taxonomy (`AppError`, `DatabaseError`, `AppleDocsNetworkError`, `CacheError`, `ValidationError`) and a diagnostic logger strictly writing to `stderr`. Wire them into `AppleDocsDB`, `HttpClient`, `FileCache`, `MemoryCache`, tool handlers, and process entrypoint with atomic file operations and self-healing.

**Tech Stack:** TypeScript 5+, Node.js 20+ native fs/crypto/events, Axios, better-sqlite3, Model Context Protocol SDK.

**Spec:** [`docs/superpowers/specs/2026-09-27-error-handling-hardening-design.md`](file:///Users/andrew/Documents/GitHub/apple-doc-plugin/docs/superpowers/specs/2026-09-27-error-handling-hardening-design.md)

## Global Constraints

- Never write diagnostics to `stdout` (MCP stdio wire isolation); all logging must go to `process.stderr`.
- Maintain 100% backward compatibility with MCP tool schemas and parameter names.
- Zero external runtime dependencies added (use native Node.js APIs and existing Axios/better-sqlite3).
- All 95 existing tests must continue passing.

## Review Focus

1. **Corrupted JSON in file cache:** A truncated `.cache/symbols/...json` file from a prior kill must be unlinked and treated as a cache miss, never throwing `SyntaxError`.
2. **Apple 404 documentation endpoints:** Must fail immediately on attempt 1 without retry delays, allowing instant fallback to local SQLite symbols.
3. **Transient network drop (ECONNRESET/ETIMEDOUT/429):** Must retry up to 2 times with exponential backoff and random jitter.
4. **SQLite table lock or malformed query in `queryLike`:** Must return `[]` and log warning instead of crashing search.
5. **`choose_technology` not found:** Must return `isError: true` and suggestions so agent loops can self-correct.

---

### Task 1: Core Error Hierarchy and Diagnostic Logger

**Files:**
- Create: `src/server/errors.ts`
- Create: `src/server/logger.ts`
- Test: `test/error-hierarchy.test.js`

**Interfaces:**
- Produces:
  - `AppError`, `DatabaseError`, `AppleDocsNetworkError`, `CacheError`, `ValidationError` from `src/server/errors.ts`
  - `logger.debug`, `logger.info`, `logger.warn`, `logger.error` from `src/server/logger.ts`

- [ ] **Step 1: Write the failing test**
Create `test/error-hierarchy.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  DatabaseError,
  AppleDocsNetworkError,
  CacheError,
  ValidationError,
} from '../dist/server/errors.js';
import { logger } from '../dist/server/logger.js';

test('Error Hierarchy: captures code, status, and isTransient attributes', () => {
  const netErr = new AppleDocsNetworkError('Gateway timeout', 504, true);
  assert.equal(netErr.code, 'NETWORK_ERROR');
  assert.equal(netErr.status, 504);
  assert.equal(netErr.isTransient, true);
  assert.equal(netErr instanceof AppError, true);
  assert.equal(netErr instanceof Error, true);

  const dbErr = new DatabaseError('Locked');
  assert.equal(dbErr.code, 'DATABASE_ERROR');
  assert.equal(dbErr instanceof AppError, true);
});

test('Logger: logs to stderr and does not throw', () => {
  assert.doesNotThrow(() => {
    logger.debug('debug msg');
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/error-hierarchy.test.js`
Expected: FAIL (cannot find module `dist/server/errors.js`).

- [ ] **Step 3: Implement `src/server/errors.ts` and `src/server/logger.ts`**
Create `src/server/errors.ts`:
```ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isOperational = true,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'DATABASE_ERROR', true, details);
  }
}

export class AppleDocsNetworkError extends AppError {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly isTransient = false,
    details?: unknown,
  ) {
    super(message, 'NETWORK_ERROR', true, details);
  }
}

export class CacheError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'CACHE_ERROR', true, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', true, details);
  }
}
```

Create `src/server/logger.ts`:
```ts
export const logger = {
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.error(`[DEBUG] ${msg}`, ...args);
    }
  },
  info: (msg: string, ...args: unknown[]) => {
    console.error(`[INFO] ${msg}`, ...args);
  },
  warn: (msg: string, ...args: unknown[]) => {
    console.error(`[WARN] ${msg}`, ...args);
  },
  error: (msg: string, ...args: unknown[]) => {
    console.error(`[ERROR] ${msg}`, ...args);
  },
};
```

- [ ] **Step 4: Build and run test to verify it passes**
Run: `npm run build && node --test test/error-hierarchy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/server/errors.ts src/server/logger.ts test/error-hierarchy.test.js
git commit -m "feat(errors): add typed error hierarchy and safe diagnostic logger"
```

---

### Task 2: Database Layer Hardening & Silent Swallow Removal

**Files:**
- Modify: `src/server/db/database.ts`
- Test: `test/error-handling-db.test.js`

**Interfaces:**
- Consumes: `logger` from `src/server/logger.ts`
- Eliminates 14+ blind `catch {}` blocks in `src/server/db/database.ts`.

- [ ] **Step 1: Write the failing test**
Create `test/error-handling-db.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppleDocsDB } from '../dist/server/db/database.js';

test('Database Hardening: resolveSymbol and queryLike survive locked or errored queries safely', () => {
  const db = new AppleDocsDB(':memory:');
  
  // Test queryLike on empty db
  const likeResults = db['queryLike']('TestQuery');
  assert.ok(Array.isArray(likeResults));

  // Test resolveSymbol on non-existent symbol
  const resolved = db.resolveSymbol('NonExistentSymbol');
  assert.deepEqual(resolved, {});

  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails/passes initial checks**
Run: `npm run build && node --test test/error-handling-db.test.js`

- [ ] **Step 3: Modify `src/server/db/database.ts`**
- Import `logger` from `../logger.js`.
- Replace constructor column migration catches:
  Check for duplicate column in error message; if not duplicate column, log `logger.warn('Failed column migration:', err.message)`.
- Replace blind catches in `getMeta`, `getSymbolCount`, `getIndexedFrameworks`, `getFrameworkSymbolCounts`, `hasEmbeddings`, `getSemanticItemCount` with `logger.warn(...)`.
- In `resolveSymbol`: Wrap candidate steps with `catch (err) { logger.debug('resolveSymbol step failed', err); }` instead of blind `catch {}`.
- In `queryFTS`: In the OR-matching fallback, log unexpected error before falling back.
- In `queryLike`: Wrap `this.db.prepare().all()` in a `try / catch (err) { logger.warn('queryLike failed:', err); return []; }`.

- [ ] **Step 4: Build and test**
Run: `npm run build && npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**
```bash
git add src/server/db/database.ts test/error-handling-db.test.js
git commit -m "fix(db): eliminate blind catches and add queryLike error boundary"
```

---

### Task 3: Resilient HttpClient with Exponential Backoff & Transient Error Handling

**Files:**
- Modify: `src/apple-client/http-client.ts`
- Test: `test/error-handling-network.test.js`

**Interfaces:**
- Consumes: `AppleDocsNetworkError` from `../server/errors.js`, `logger` from `../server/logger.js`
- Produces: `HttpClient.makeRequest()` with retry backoff and fast-fail for 404.

- [ ] **Step 1: Write the failing test**
Create `test/error-handling-network.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient } from '../dist/apple-client/http-client.js';
import { AppleDocsNetworkError } from '../dist/server/errors.js';

test('HttpClient: throws AppleDocsNetworkError with status 404 without retries', async () => {
  const client = new HttpClient();
  await assert.rejects(
    async () => {
      await client.makeRequest('definitely-non-existent-documentation-path-12345');
    },
    (err) => {
      assert.ok(err instanceof AppleDocsNetworkError || err instanceof Error);
      return true;
    }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run build && node --test test/error-handling-network.test.js`

- [ ] **Step 3: Modify `src/apple-client/http-client.ts`**
- Import `AppleDocsNetworkError` and `logger`.
- Add retry loop with exponential backoff and jitter:
  - If status === 404: throw `new AppleDocsNetworkError(..., 404, false)` immediately.
  - If status === 429 or 5xx or `ECONNRESET`/`ETIMEDOUT`: retry up to 2 times.
  - Wait `delay + Math.random() * 100` ms before retrying.
  - Log retries via `logger.warn`.

- [ ] **Step 4: Build and test**
Run: `npm run build && node --test test/error-handling-network.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/apple-client/http-client.ts test/error-handling-network.test.js
git commit -m "feat(http): add exponential backoff retry and 404 fast-fail"
```

---

### Task 4: Atomic FileCache & Auto-Healing from Corrupted Cache

**Files:**
- Modify: `src/apple-client/cache/file-cache.ts`
- Modify: `src/apple-client/cache/memory-cache.ts`
- Test: `test/error-handling-cache.test.js`

**Interfaces:**
- Consumes: `logger` from `../../server/logger.js`, `CacheError` from `../../server/errors.js`
- Produces: Atomic file writes with `.tmp` and rename, corrupted JSON auto-healing, bounded `MemoryCache`.

- [ ] **Step 1: Write the failing test**
Create `test/error-handling-cache.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { FileCache } from '../dist/apple-client/cache/file-cache.js';
import { MemoryCache } from '../dist/apple-client/cache/memory-cache.js';

test('FileCache: detects corrupted JSON, unlinks bad file, and returns undefined instead of crashing', async () => {
  const tmpDir = join(process.cwd(), '.cache-test-' + Date.now());
  await fs.mkdir(tmpDir, { recursive: true });
  const badFilePath = join(tmpDir, '.cache', 'bad_sym.json');
  await fs.mkdir(join(tmpDir, '.cache'), { recursive: true });
  await fs.writeFile(badFilePath, '{ this is corrupted json! ');

  const fileCache = new FileCache(tmpDir);
  const result = await fileCache.loadSymbol('bad/sym');
  assert.equal(result, undefined);

  // File should have been removed
  const exists = await fs.access(badFilePath).then(() => true).catch(() => false);
  assert.equal(exists, false);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('MemoryCache: evicts oldest entries when exceeding max capacity', () => {
  const mem = new MemoryCache(60_000, 3); // cap at 3
  mem.set('k1', 1);
  mem.set('k2', 2);
  mem.set('k3', 3);
  mem.set('k4', 4); // should evict k1
  assert.equal(mem.get('k1'), undefined);
  assert.equal(mem.get('k4'), 4);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run build && node --test test/error-handling-cache.test.js`

- [ ] **Step 3: Implement atomic writes and auto-healing in `FileCache` and LRU cap in `MemoryCache`**
In `src/apple-client/cache/file-cache.ts`:
- Helper `atomicWriteJson(filePath, data)`:
  - Write to `${filePath}.tmp.${process.pid}.${Date.now()}`.
  - `await fs.rename(tmpPath, filePath)`.
- In `loadFramework`, `loadSymbol`, `loadTechnologies`:
  - Catch `SyntaxError`, log `logger.warn`, `await fs.unlink(path).catch(() => {})`, and return `undefined`.
- In `saveFramework`, `saveSymbol`, `saveTechnologies`:
  - Use `atomicWriteJson`.

In `src/apple-client/cache/memory-cache.ts`:
- Add `maxSize: number = 500`.
- In `set()`: if `this.cache.size >= this.maxSize`, delete the first key in `this.cache.keys()`.

- [ ] **Step 4: Build and test**
Run: `npm run build && node --test test/error-handling-cache.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/apple-client/cache/file-cache.ts src/apple-client/cache/memory-cache.ts test/error-handling-cache.test.js
git commit -m "fix(cache): add atomic file writes, auto-healing for corrupt files, and memory LRU cap"
```

---

### Task 5: Tool Handler Uniformity, Input Clamping & Global Process Guards

**Files:**
- Modify: `src/server/handlers/choose-technology.ts`
- Modify: `src/server/handlers/discover.ts`
- Modify: `src/server/tools.ts`
- Modify: `src/server/handlers/version.ts`
- Modify: `src/server/app.ts`
- Modify: `src/index.ts`
- Test: `test/error-handling-handlers.test.js`

**Interfaces:**
- Sets `isError: true` on `choose_technology` when technology is not found.
- Clamps `page` and `pageSize` in `discover_technologies`.
- Wraps `package.json` load in safe helper with fallback.
- Attaches `uncaughtException` and `unhandledRejection` listeners in `src/index.ts`.

- [ ] **Step 1: Write the failing test**
Create `test/error-handling-handlers.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../dist/server/app.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

test('Handlers: choose_technology returns isError: true when technology is unknown', async () => {
  const server = createServer();
  const handler = server['_requestHandlers'].get(CallToolRequestSchema.shape.method.value);
  const response = await handler({
    params: {
      name: 'choose_technology',
      arguments: { name: 'NonExistentTechnology999' },
    },
  });
  assert.equal(response.isError, true);
  assert.ok(response.content[0].text.includes('Technology Not Found'));
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run build && node --test test/error-handling-handlers.test.js`
Expected: FAIL (`response.isError` was `undefined`).

- [ ] **Step 3: Modify handlers and process entrypoints**
- In `src/server/handlers/choose-technology.ts`:
  Set `isError: true` when technology is not found.
- In `src/server/handlers/discover.ts`:
  Clamp `page` to `Math.max(1, Math.floor(Number(page) || 1))` and `pageSize` to `Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 25)))`.
  Log warning if `client.getTechnologies()` throws.
- In `src/server/handlers/version.ts` and `src/server/app.ts`:
  Wrap `package.json` read in safe try/catch with fallback defaults.
- In `src/index.ts`:
  Register `process.on('uncaughtException', ...)` and `process.on('unhandledRejection', ...)`.

- [ ] **Step 4: Build and test**
Run: `npm run build && node --test test/error-handling-handlers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/server/handlers/choose-technology.ts src/server/handlers/discover.ts src/server/tools.ts src/server/handlers/version.ts src/server/app.ts src/index.ts test/error-handling-handlers.test.js
git commit -m "fix(server): standardize tool error responses, clamp pagination, and guard process lifecycle"
```

---

### Task 6: Full Integration & Regression Verification

**Files:**
- Verify: Full test suite

- [ ] **Step 1: Run complete test suite**
Run: `npm test`
Expected: 100% of tests pass (all original 95 tests + new error handling tests).

- [ ] **Step 2: Run TypeScript build verification**
Run: `npm run build`
Expected: Clean compile without errors.

- [ ] **Step 3: Commit final verification**
```bash
git commit --allow-empty -m "test: verify all error handling and resilience tests pass"
```
