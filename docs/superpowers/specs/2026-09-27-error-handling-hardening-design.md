# Architecture Specification: Comprehensive Error Handling & Resilience Hardening

**Date**: 2026-09-27  
**Status**: Approved (Brainstorming Phase)  
**Target Repository**: `apple-doc-plugin`  

---

## 1. Executive Summary & Problem Context

The `apple-doc-plugin` Model Context Protocol (MCP) server provides documentation search, browsing, and symbol resolution for Apple developer frameworks (SwiftUI, UIKit, Foundation, Observation, etc.) using local SQLite databases, Gemini vector embeddings, and official Apple Developer Documentation endpoints.

A comprehensive architectural audit identified several reliability and error handling vulnerabilities across all system layers:
1. **Database Layer**: Over 14 blind `catch {}` blocks in `src/server/db/database.ts` silently swallow SQLite errors (database disk image corruption, database locks, or query planning failures), masking critical operational errors.
2. **Protocol & Tool Dispatch Layer**: Inconsistent error response models. Some handlers throw raw `McpError` (which gets flattened in `tools.ts`), while others return `{ isError: true }`. Furthermore, `choose_technology` returns `{ isError: undefined }` on missing technologies, confusing LLM agent self-correction.
3. **HTTP & Remote Fetch Layer**: `HttpClient` lacks retry mechanisms with exponential backoff for transient HTTP errors (429, 502, 503, 504, ECONNRESET, ETIMEDOUT) and treats 404 Not Found identically to internal server errors.
4. **Caching Layer**: `FileCache` performs direct, non-atomic writes. Interrupted writes create truncated JSON files. When subsequently loaded, `JSON.parse` throws `SyntaxError`, which is rethrown (because it is not `ENOENT`), causing an unrecoverable cache crash loop.
5. **Process Lifecycle**: Missing `uncaughtException` and `unhandledRejection` guards in `src/index.ts`, and top-level synchronous `readFileSync` calls in `version.ts` that risk crashing the Node process and terminating the MCP stdio communication pipe.

---

## 2. Goals & Non-Goals

### Goals
- **Eliminate Silent Swallows**: Replace all 14+ blind `catch {}` blocks with structured, level-aware diagnostic logging to `stderr`.
- **Standardize Tool Error Contracts**: Ensure all tool handlers return actionable, agent-friendly error responses with `isError: true`, contextual guidance, and copy-paste repair queries.
- **Network Resilience**: Add exponential backoff with jitter and transient status code classification (429/5xx vs 404) in `HttpClient`.
- **Atomic Caching & Self-Healing**: Guarantee that corrupted cache files are automatically purged rather than crashing the server, and file writes are performed atomically.
- **Process Protection**: Install unhandled rejection and exception boundaries in `src/index.ts` to ensure stdio pipe preservation.
- **100% Backward Compatibility**: Preserve existing tool schemas, method signatures, and all 95 existing tests.

### Non-Goals
- Changing database schema or SQLite FTS5 table structures.
- Introducing heavy external dependencies for logging or retry logic (all improvements will use native Node.js APIs and existing libraries).
- Modifying MCP JSON-RPC protocol wire format.

---

## 3. Architectural Design

```
+---------------------------------------------------------------------------------+
|                                 MCP Client (AI Agent)                           |
+---------------------------------------------------------------------------------+
                                      |  Stdio JSON-RPC
                                      v
+---------------------------------------------------------------------------------+
|                       src/index.ts (Process Lifecycle Guards)                   |
|                   uncaughtException & unhandledRejection -> stderr              |
+---------------------------------------------------------------------------------+
                                      |
                                      v
+---------------------------------------------------------------------------------+
|                       src/server/tools.ts (Tool Dispatch)                       |
|           Catches AppError / McpError / ValidationError -> { isError: true }    |
+---------------------------------------------------------------------------------+
                                      |
         +----------------------------+----------------------------+
         |                                                         |
         v                                                         v
+-----------------------------------+             +-------------------------------+
|    Tool Handlers                  |             |   Diagnostic Logger           |
|    - get-documentation            |             |   src/server/logger.ts        |
|    - search-symbols               |             |   - Safe stderr output only   |
|    - choose-technology (isError)  |             |   - debug/info/warn/error     |
|    - discover (clamped params)    |             +-------------------------------+
+-----------------------------------+                              ^
         |                                                         |
         +----------------------------+----------------------------+
                                      |
         +----------------------------+----------------------------+
         |                                                         |
         v                                                         v
+-----------------------------------+             +-------------------------------+
|  SQLite DB (src/server/db/)       |             |  HTTP & Cache (apple-client/) |
|  - Zero blind catch blocks        |             |  - HttpClient (backoff+jitter)|
|  - queryLike() error boundary     |             |  - FileCache (atomic+heal)    |
|  - resolveSymbol() warned stages  |             |  - MemoryCache (bounded LRU)  |
+-----------------------------------+             +-------------------------------+
```

---

## 4. Component Specifications

### 4.1. Error Taxonomy (`src/server/errors.ts`)
Introduce structured error classes inheriting from `AppError`:
- `AppError`: Base application error with `code`, `isOperational`, and optional `details`.
- `DatabaseError`: Specific to SQLite operations.
- `AppleDocsNetworkError`: HTTP request failures with `status` and `isTransient` flags.
- `CacheError`: Cache read/write/parsing failures.
- `ValidationError`: Schema and argument boundary violations.

### 4.2. Diagnostic Logger (`src/server/logger.ts`)
- Never writes to `stdout` (MCP stdio isolation).
- Outputs timestamped, level-tagged messages to `process.stderr`.
- Respects `DEBUG` or `NODE_ENV=development` for debug-level traces.

### 4.3. Database Hardening (`src/server/db/database.ts`)
- **Constructor Migrations**: Catch column additions and verify if error is expected (duplicate column) before ignoring; warn on unexpected SQLite errors.
- **Counts and Metadata**: Catch database errors, log at `warn` level with query name, and return safe default values (`0`, `[]`, `undefined`).
- **`resolveSymbol()`**: Catch errors in each candidate step (exact, case-insensitive, normalized path, title, suffix) with contextual warnings, allowing clean progression without blind swallows.
- **`queryLike()`**: Wrap `this.db.prepare().all()` in a `try / catch` block returning `[]` and logging on failure.
- **FTS OR-Matching**: Replace blind `catch {}` with diagnostic logging.

### 4.4. Network Client Resilience (`src/apple-client/http-client.ts`)
- **Exponential Backoff**: For status codes 429, 500, 502, 503, 504 and network errors (`ECONNRESET`, `ETIMEDOUT`, `ECONNABORTED`), retry up to 2 times with initial delay of 250ms and random jitter (0-100ms).
- **Fast Fail for 404**: Status code 404 throws immediately marked as `isTransient: false`, allowing callers (`get-documentation`) to fall back instantly to local offline DB without delaying response.

### 4.5. Cache Atomic Writes & Auto-Healing (`src/apple-client/cache/file-cache.ts` & `memory-cache.ts`)
- **Atomic File Writing**: Write to temporary file `${targetPath}.tmp.${Date.now()}.${Math.random()}` and atomically rename over target path via `fs.rename()`.
- **Corrupted Cache Healing**: In `loadFramework()`, `loadSymbol()`, and `loadTechnologies()`, catch `SyntaxError` on `JSON.parse()`, log a warning, delete the corrupted file with `fs.unlink()`, and return `undefined` to trigger fresh fetching.
- **Bounded Memory Cache**: Add maximum size limit (500 items) and eviction policy to prevent memory leaks during long-running sessions.

### 4.6. Handlers & Tool Uniformity
- **`choose-technology`**: Return `isError: true` when technology is not found, along with structured fuzzy suggestions.
- **`discover-technologies`**: Sanitize and clamp `page` (`>= 1`) and `pageSize` (`1` to `100`), and log warning if `client.getTechnologies()` fails while continuing with DB frameworks.
- **`tools.ts`**: Format tool errors consistently, capturing typed error details and outputting clean Markdown blocks.

### 4.7. Process Lifecycle & Metadata Safety
- **`src/index.ts`**: Attach `process.on('uncaughtException')` and `process.on('unhandledRejection')` with structured `stderr` logging.
- **`version.ts` & `app.ts`**: Wrap `package.json` reads in a safe helper with fallback metadata (`apple-doc-plugin` v1.0.0).

---

## 5. Verification & Testing Plan

### Automated Tests
Create new test suites in `test/`:
1. `test/error-handling-network.test.js`:
   - 404 fails immediately without retrying.
   - 429 and 503 retry with backoff and succeed if subsequent attempt returns 200.
   - Exhausted retries throw `AppleDocsNetworkError` with `isTransient: true`.
2. `test/error-handling-cache.test.js`:
   - Corrupted JSON on disk is detected, purged via `unlink`, and returns `undefined`.
   - Atomic writes prevent partial file generation.
   - Memory cache stays bounded under high entry load.
3. `test/error-handling-db.test.js`:
   - `queryLike()` survives synthetic SQLite errors without throwing.
   - `resolveSymbol()` logs warnings and falls through safely.
4. `test/error-handling-handlers.test.js`:
   - `choose_technology` returns `isError: true` with suggestions on invalid input.
   - `discover_technologies` clamps `NaN`, negative, and extreme `page`/`pageSize` values.

### Regression Verification
Execute full test suite:
```bash
npm test
```
All existing 95 tests must pass without modification (or with aligned assertions for `choose_technology` error flag).

---

## 6. Self-Review & Acceptance Criteria
- [x] Zero placeholders (no "TBD" or "TODO").
- [x] Clean separation of concerns between DB, HTTP, Cache, and Handlers.
- [x] Strict adherence to MCP `stdio` stream integrity (only `stderr` for logs).
- [x] Clear backwards compatibility guarantee.
