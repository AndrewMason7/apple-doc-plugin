# Runtime DB Hydration, Model Provenance & Hermes Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate in-place git/tarball corruption from background vector hydration, close the cold-start status race, guard 768-d hybrid search against cross-model vector mismatches, calibrate Gemini RRF preferred similarity, and register the bundled `apple-docs` skill in Hermes.

**Architecture:** Split `db-path.ts` into an immutable git-tracked lexical seed (`data/apple-docs.db`, `< 50 MB`) and an untracked auto-seeded runtime copy (`data/apple-docs.runtime.db` or XDG cache fallback when read-only) shared by the server, doctor, and CLI scripts. Propagate `embedding_model` provenance through SQLite `meta`, vector manifests, `HybridSearchEngine`, and diagnostics, surface live `hydrating` state during async startup import, and wire `ctx.register_skill` in the Hermes Python bridge.

**Tech Stack:** TypeScript 5.9 (Node.js >= 22 ESM, `node:test`), `better-sqlite3`, `sqlite-vec`, Python 3.11+ (`pytest`, Hermes Plugin API v1 / Manifest v2).

**Spec:** `docs/superpowers/specs/2026-11-10-runtime-hydration-and-provenance-design.md`

## Global Constraints

- Node.js `>= 22`, strict TypeScript (`npm run typecheck`) and Prettier (`npm run format:check` — tabs, single quotes) must pass with 0 warnings/errors.
- Published `npm pack --dry-run` tarball size must stay strictly `< 75 MB` (`75 * 1024 * 1024` bytes) even after the server has booted and hydrated all `19,473` vectors.
- Every runtime entry point (`src/server/app.ts`, `scripts/doctor.ts`, `scripts/embed-index.ts`, `scripts/repair-index.ts`, `src/server/services/download-vectors.ts`) must resolve its active DB via `resolveDbPath()` — never a hardcoded path literal; only `scripts/build-index.ts` writes `resolveSeedDbPath()`.
- `plugin.yaml`, `plugin.json`, and `package.json` versions must remain synchronized (`1.0.3` until explicit release bump) and `hermes plugins doctor apple-doc-plugin --ci` must exit `0`.
- Stdio MCP discipline: never write diagnostics to `stdout` in server/bridge paths (`logger` / `stderr` only).

## Review Focus

1. **Stale WAL replay on seed refresh:** Overwriting `apple-docs.runtime.db` via `renameSync` while an older `apple-docs.runtime.db-wal` / `-shm` remains on disk causes SQLite to replay WAL frames from the old database onto the new seed and corrupt pages; `ensureRuntimeDbSeeded` must unlink `-wal` and `-shm` sidecars before renaming the temp copy into place.
2. **Read-only install prefix (`npm install -g` / Homebrew):** When `<PROJECT_ROOT>/data` lacks write permission (`EACCES`), `resolveDbPath` must fall back to `${XDG_CACHE_HOME || ~/.cache}/apple-docs/apple-docs.runtime.db` and create parent directories cleanly rather than crashing server startup.
3. **Mixed-model incremental `embed-index` without `--force`:** Running `npm run embed-index` with `local-gguf` against a runtime DB already hydrated with `gemini-embedding-2` vectors would create a half-Gemini, half-Gemma 768-d corpus; `embedSymbols()` must refuse unless `options.force === true` (which clears prior vectors and updates `meta.embedding_model`).
4. **Legacy v1 vector artifact import without `meta.embedding_model`:** Importing the currently shipped `assets/apple-docs-vectors-768d.db.gz` (formatVersion 1, SHA-256 `a149456a...`) has no `embedding_model` row inside its SQLite `meta`; `downloadVectors` must stamp `gemini-embedding-2` / `gemini` when the verified SHA matches `VECTOR_ARTIFACT_SHA256`, while unknown third-party v1 bundles remain `'unknown'` without false-failing.
5. **Custom `APPLE_DOCS_DB_PATH` isolation:** When a caller sets `APPLE_DOCS_DB_PATH=/custom/test.db` (or `:memory:`), `ensureRuntimeDbSeeded` must NOT overwrite or copy `data/apple-docs.db` over their custom fixture DB.

---

### Task 1: Separate Immutable Seed DB from Writable Runtime DB

**Files:**

- Modify: `src/server/db/db-path.ts`
- Modify: `src/server/app.ts:64-80`
- Modify: `src/server/services/download-vectors.ts:204-215,432-445`
- Modify: `scripts/build-index.ts`
- Modify: `scripts/doctor.ts`
- Modify: `scripts/embed-index.ts`
- Modify: `scripts/repair-index.ts`
- Modify: `.gitignore`
- Modify: `test/unit/db-path.test.js`
- Modify: `test/cli/npm-pack.test.js`

**Interfaces:**

- Produces in `src/server/db/db-path.ts`:
  - `export const SEED_DB_RELATIVE_PATH = 'data/apple-docs.db';`
  - `export const DEFAULT_DB_RELATIVE_PATH = 'data/apple-docs.runtime.db';`
  - `export interface DbPathOverrides { env?: NodeJS.ProcessEnv; root?: string; writableCheck?: (dir: string) => boolean; homeDir?: string; }`
  - `export function resolveSeedDbPath(overrides?: DbPathOverrides): string`
  - `export function resolveDbPath(overrides?: DbPathOverrides): string`
  - `export function ensureRuntimeDbSeeded(overrides?: DbPathOverrides): string`

- [ ] **Step 1: Restore tracked `data/apple-docs.db` to clean lexical seed and ignore runtime DB**

Run: `git checkout -- data/apple-docs.db` and append `data/apple-docs.runtime.db*` to `.gitignore`.
Verify: `git status --short data/apple-docs.db` outputs nothing.

- [ ] **Step 2: Write failing unit tests in `test/unit/db-path.test.js`**

Add assertions covering:

```javascript
test('resolveSeedDbPath points to data/apple-docs.db while resolveDbPath points to data/apple-docs.runtime.db when writable', () => {
	assert.strictEqual(
		resolveSeedDbPath({ env: {} }),
		path.join(REPO_ROOT, 'data', 'apple-docs.db'),
	);
	assert.strictEqual(
		resolveDbPath({ env: {}, writableCheck: () => true }),
		path.join(REPO_ROOT, 'data', 'apple-docs.runtime.db'),
	);
});

test('resolveDbPath falls back to XDG_CACHE_HOME when project data dir is read-only', () => {
	const resolved = resolveDbPath({
		env: { XDG_CACHE_HOME: '/tmp/xdg-cache' },
		writableCheck: () => false,
	});
	assert.strictEqual(
		resolved,
		'/tmp/xdg-cache/apple-docs/apple-docs.runtime.db',
	);
});

test('ensureRuntimeDbSeeded copies seed DB, strips stale WAL sidecars, refreshes when built_at changes, and never touches explicit APPLE_DOCS_DB_PATH', () => {
	// Create temp root with data/apple-docs.db (built_at = T1), pre-plant corrupt runtime.db-wal,
	// call ensureRuntimeDbSeeded({ env: {}, root: tmpRoot }), assert runtime.db exists, -wal is gone,
	// symbol count matches seed. Mutate seed built_at = T2, re-run, assert runtime built_at === T2.
	// Call with env: { APPLE_DOCS_DB_PATH: customEmptyPath } and assert customEmptyPath is NOT overwritten.
});
```

Also update the static grep test in `test/unit/db-path.test.js` so `scripts/build-index.ts` is checked for `resolveSeedDbPath` while `app.ts`, `doctor.ts`, `embed-index.ts`, and `repair-index.ts` are checked for `resolveDbPath`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run build && node --test test/unit/db-path.test.js`
Expected: FAIL (`resolveSeedDbPath` / `ensureRuntimeDbSeeded` not exported).

- [ ] **Step 4: Implement `resolveSeedDbPath`, XDG fallback in `resolveDbPath`, and `ensureRuntimeDbSeeded` in `src/server/db/db-path.ts`, then wire consumers**

Implementation requirements:

- `defaultWritableCheck(dir)` checks `accessSync(existsSync(dir) ? dir : dirname(dir), constants.W_OK)` inside `try/catch`.
- `ensureRuntimeDbSeeded(overrides)` returns `target = resolveDbPath(overrides)` immediately if `overrides?.env?.APPLE_DOCS_DB_PATH ?? process.env.APPLE_DOCS_DB_PATH` is non-empty or `isVirtualDbPath(target)`. Otherwise compares `built_at` in `meta` (via lightweight `better-sqlite3` readonly open inside `try/catch`); when missing or mismatched and seed exists, unlinks `${target}-wal` and `${target}-shm` if present, copies seed to `${target}.seed.${process.pid}.tmp`, and `renameSync`s to `target`.
- Call `ensureRuntimeDbSeeded()` before opening SQLite in `src/server/app.ts`, `scripts/doctor.ts`, `scripts/embed-index.ts`, `scripts/repair-index.ts`, and `downloadVectors()` (when `options.dbPath` is omitted). Update `scripts/build-index.ts` to write `resolveSeedDbPath()`.

- [ ] **Step 5: Strengthen `test/cli/npm-pack.test.js` to prove hydrated runtime DB never leaks into tarball**

In `test/cli/npm-pack.test.js`, call `ensureRuntimeDbSeeded()` before `npm pack --dry-run --json` and assert:

- `!filenames.some((f) => f.includes('runtime.db'))`
- `packInfo.size < 75 * 1024 * 1024`

- [ ] **Step 6: Run tests to verify Task 1 passes**

Run: `npm run build && node --test test/unit/db-path.test.js test/cli/npm-pack.test.js`
Expected: PASS (tarball `< 75 MB`, `git status --short data/apple-docs.db` empty).

- [ ] **Step 7: Commit**

```bash
git add .gitignore src/server/db/db-path.ts src/server/app.ts src/server/services/download-vectors.ts scripts/build-index.ts scripts/doctor.ts scripts/embed-index.ts scripts/repair-index.ts test/unit/db-path.test.js test/cli/npm-pack.test.js
git commit -m "fix(db): isolate writable runtime index from git-tracked seed db"
```

---

### Task 2: Expose In-Flight Hydration Status on Cold Start

**Files:**

- Modify: `src/server/services/download-vectors.ts:404-484`
- Modify: `src/server/handlers/version.ts:54-198,250-320`
- Modify: `src/server/services/doctor.ts:19-34,260-340`
- Test: `test/unit/zero-step-hybrid.test.js`

**Interfaces:**

- Produces in `src/server/services/download-vectors.ts`:
  - `export function isAutoImportInFlight(): boolean`
  - `export function setAutoImportInFlightForTest(promise: Promise<boolean> | null): void` (test seam so unit tests do not race a 5s gunzip)
- Modify `IndexMetadata` in `src/server/handlers/version.ts`: add `hydrating: boolean;`
- Modify `DoctorContext` in `src/server/services/doctor.ts`: add `hydrating?: boolean;`

- [ ] **Step 1: Write failing test in `test/unit/zero-step-hybrid.test.js`**

```javascript
test('Zero-step hybrid: get_version, index_info, and doctor report hydrating state while background import is in flight', async () => {
	// Open empty temp AppleDocsDB (0 vectors), set a deferred promise via setAutoImportInFlightForTest(deferred.promise),
	// call buildVersionHandler({ db, state, client })() and buildIndexInfoHandler({ db, state, client })().
	// Assert output matches /Hydrating bundled 768-d vectors in background/i,
	// assert output does NOT match /npm run download-vectors/,
	// and assert runDoctor({ db, dbPath, provider, nodeVersion: 'v24.0.0', hydrating: true }) has 0 failures and semantic_layer status === 'ok' or 'hydrating' detail without false warning.
	// Resolve deferred and reset setAutoImportInFlightForTest(null).
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/unit/zero-step-hybrid.test.js`
Expected: FAIL (`isAutoImportInFlight` / `setAutoImportInFlightForTest` undefined).

- [ ] **Step 3: Implement `isAutoImportInFlight` and wire `version.ts` + `doctor.ts`**

- In `download-vectors.ts`: export `isAutoImportInFlight = () => activeAutoImportPromise !== null` and `setAutoImportInFlightForTest`.
- In `version.ts`: set `hydrating: !embeddingStatus.storageHasVectors && isAutoImportInFlight()`. When `meta.hydrating` is `true`:
  - `get_version` prints `🔎 Search Capability: Hydrating bundled 768-d vectors in background — lexical FTS5 active now, hybrid ready in a few seconds`
  - `index_info` prints `• **Mode:** hydrating` and passes `hydrating: true` into `runDoctor(...)`.
- In `doctor.ts`: when `!status.storageHasVectors && context.hydrating`, emit `check('semantic_layer', 'Semantic layer', 'ok', 'hydrating bundled 768-d vectors in background')` instead of the `0/100` warning.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/unit/zero-step-hybrid.test.js test/unit/doctor.test.js test/unit/version.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/download-vectors.ts src/server/handlers/version.ts src/server/services/doctor.ts test/unit/zero-step-hybrid.test.js
git commit -m "fix(status): report in-flight vector hydration instead of empty lexical warning"
```

---

### Task 3: Stamp and Enforce Embedding Model Provenance

**Files:**

- Modify: `src/server/services/search/embedding-provider.ts`
- Modify: `src/server/services/search/semantic-search.ts`
- Modify: `src/server/services/search/local-gemma-provider.ts`
- Modify: `src/server/services/symbol-embeddings.ts`
- Modify: `src/server/services/export-vectors.ts`
- Modify: `src/server/services/download-vectors.ts:353-372`
- Modify: `src/server/db/database.ts:495-530,1595-1635`
- Modify: `src/server/services/search/hybrid-search.ts`
- Modify: `src/server/handlers/search-symbols.ts:299-335`
- Modify: `src/server/handlers/version.ts`
- Modify: `src/server/services/doctor.ts`
- Modify: `assets/apple-docs-vectors-768d.db.manifest.json`
- Create: `test/unit/embedding-model-provenance.test.js`

**Interfaces:**

- `EmbeddingProvider` (`embedding-provider.ts`): add `readonly modelId: string;`
  - `GeminiSemanticSearch`: `modelId` equals normalized model slug (e.g. `'gemini-embedding-2'`)
  - `LocalGemmaEmbeddingProvider`: `modelId = 'embeddinggemma-2'`
  - `UnavailableEmbeddingProvider`: `modelId = 'none'`
- `AppleDocsDB` (`database.ts`):
  - `getStoredEmbeddingModel(): string | null` (reads `this.getMeta('embedding_model') ?? null`)
- `export function areEmbeddingModelsCompatible(storedModel: string | null, queryModel: string): boolean` in `embedding-provider.ts`:
  - Returns `true` if `!storedModel || storedModel === 'unknown' || queryModel === 'none'`, else compares canonical lowercase family (`storedModel.replace(/^models\//, '').toLowerCase() === queryModel.replace(/^models\//, '').toLowerCase()`).

- [ ] **Step 1: Write failing tests in `test/unit/embedding-model-provenance.test.js`**

Test all 4 cases:

1. `embedSymbols` stamps `meta.embedding_model` and `meta.embedding_provider`, and throws `/model mismatch.*--force/i` when invoked with a `'embeddinggemma-2'` provider on a non-empty `'gemini-embedding-2'` DB without `force: true` (succeeds and overwrites when `force: true`).
2. `HybridSearchEngine.search` with `768-d` `embeddinggemma-2` query provider against `768-d` `gemini-embedding-2` stored vectors skips cosine fusion, logs one warning, and `search_symbols` (`preferSemantic: true`) emits a `Lexical fallback (embedding model mismatch: index uses gemini-embedding-2, active provider uses embeddinggemma-2)` banner.
3. `get_version`, `index_info`, and `runDoctor` flag the model mismatch even when both sides are `768-d`.
4. Importing a v1 vector DB without `meta.embedding_model` stamps `'gemini-embedding-2'` when `pinned === true` (`VECTOR_ARTIFACT_SHA256`), and leaves `'unknown'` (compatible without false-positive failure) for unpinned custom bundles.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/unit/embedding-model-provenance.test.js`
Expected: FAIL (`Cannot find module` / missing `modelId` and provenance checks).

- [ ] **Step 3: Implement `modelId` across providers, DB/export/import stamping, and search/doctor guards**

- Add `modelId` to `EmbeddingProvider`, `GeminiSemanticSearch`, `LocalGemmaEmbeddingProvider`, `UnavailableEmbeddingProvider`, and `areEmbeddingModelsCompatible` in `embedding-provider.ts` (also update any mock providers in existing unit tests if `isEmbeddingProvider` checks `typeof p.modelId === 'string'` — keep `modelId` optional in `isEmbeddingProvider` runtime duck-check or default to `'unknown'` so existing test mocks stay green).
- In `symbol-embeddings.ts`: guard mixed-model writes when `!options.force && db.getSemanticItemCount() > 0`, clear existing semantic items when `options.force && mismatched`, and stamp `db.setMeta('embedding_model', provider.modelId)` + `db.setMeta('embedding_provider', provider.id)`.
- In `export-vectors.ts` & `assets/apple-docs-vectors-768d.db.manifest.json`: add `embeddingModel: string` (`"gemini-embedding-2"`) and `embeddingProvider: string` (`"gemini"`). Note: updating `.manifest.json` does NOT touch `.db.gz`, so `VECTOR_ARTIFACT_SHA256` remains intact.
- In `database.ts` `importVectorsFromDb(sourceDbPath, fallbackModel?)`: copy `embedding_model` and `embedding_provider` from source `meta` if present, else apply `fallbackModel` (`{ model: 'gemini-embedding-2', provider: 'gemini' }` passed by `downloadVectors` when `attempt.pinned === true`).
- In `hybrid-search.ts`, `search-symbols.ts`, `version.ts`, and `doctor.ts`: check `areEmbeddingModelsCompatible(db.getStoredEmbeddingModel(), provider.modelId)` alongside dimension compatibility.

- [ ] **Step 4: Run unit test suite to verify Task 3 passes with zero regressions**

Run: `npm run build && node --test test/unit/*.test.js`
Expected: PASS (all existing 287+ tests and new provenance tests green).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/search/embedding-provider.ts src/server/services/search/semantic-search.ts src/server/services/search/local-gemma-provider.ts src/server/services/symbol-embeddings.ts src/server/services/export-vectors.ts src/server/services/download-vectors.ts src/server/db/database.ts src/server/services/search/hybrid-search.ts src/server/handlers/search-symbols.ts src/server/handlers/version.ts src/server/services/doctor.ts assets/apple-docs-vectors-768d.db.manifest.json test/unit/embedding-model-provenance.test.js
git commit -m "feat(search): track and enforce 768-d embedding model provenance"
```

---

### Task 4: Calibrate Gemini RRF Floor, Align Manifests & Register Hermes Skill

**Files:**

- Modify: `src/server/services/search/semantic-search.ts`
- Modify: `plugin.yaml`
- Modify: `plugin.json`
- Modify: `bridges/hermes/__init__.py`
- Modify: `test/unit/similarity-thresholds.test.js`
- Modify: `test/python/test_hermes_registration.py`
- Modify: `test/python/test_hermes_manifest.py`

**Interfaces:**

- `GeminiSemanticSearch` (`src/server/services/search/semantic-search.ts`):
  - `public readonly minSimilarity = 0.65;`
  - `public readonly minSimilarityPreferred = 0.62;` (replaces implicit `0.55` fallback in `resolveMinSimilarity`)
- `bridges/hermes/__init__.py`:
  - `register(ctx)` additionally calls `ctx.register_skill(name="apple-docs", path=skill_md_path, description=...)` when `hasattr(ctx, "register_skill") and callable(ctx.register_skill)` and `skills/apple-docs/SKILL.md` exists.

- [ ] **Step 1: Write failing tests in `test/unit/similarity-thresholds.test.js` and `test/python/test_hermes_registration.py`**

In `test/unit/similarity-thresholds.test.js`:

```javascript
test('GeminiSemanticSearch sets minSimilarityPreferred to 0.62 to reject sub-0.62 lexical-boosted distractors', () => {
	const provider = new GeminiSemanticSearch('test-key');
	assert.strictEqual(resolveMinSimilarity(provider, false), 0.65);
	assert.strictEqual(resolveMinSimilarity(provider, true), 0.62);
});
```

In `test/python/test_hermes_registration.py`:

```python
def test_register_exposes_bundled_apple_docs_skill():
    # Mock ctx with register_tool and register_skill spies; call register(ctx).
    # Assert register_skill called once with name="apple-docs" and path ending in "skills/apple-docs/SKILL.md" (exists on disk).
```

In `test/python/test_hermes_manifest.py`: assert neither `plugin.yaml` nor `plugin.json` claims `"multimodal UI layout previews"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test test/unit/similarity-thresholds.test.js && PYTHONPATH=/home/claw/.hermes/hermes-agent uvx --with pyyaml --with pytest pytest test/python/ -q`
Expected: FAIL (`0.55 !== 0.62`, `register_skill` not called, manifest string still present).

- [ ] **Step 3: Implement threshold update, manifest copy fix, and `ctx.register_skill` registration**

- Set `public readonly minSimilarity = 0.65;` and `public readonly minSimilarityPreferred = 0.62;` on `GeminiSemanticSearch` in `src/server/services/search/semantic-search.ts`.
- In `plugin.yaml` and `plugin.json`, replace `"multimodal UI layout previews"` with `"hybrid semantic and cross-framework idiom search"`.
- In `bridges/hermes/__init__.py`, resolve `skill_path = Path(__file__).resolve().parents[2] / "skills" / "apple-docs" / "SKILL.md"` and parse its YAML frontmatter description (or pass the canonical 1-line description) to `ctx.register_skill("apple-docs", skill_path, description=...)` when `hasattr(ctx, "register_skill")`.

- [ ] **Step 4: Run full verification suite (TypeScript, Prettier, Node unit/CLI/integration, Python, Hermes Doctor)**

Run:

```bash
npm run check
npm test
PYTHONPATH=/home/claw/.hermes/hermes-agent uvx --with pyyaml --with pytest pytest test/python/ -q
hermes plugins doctor apple-doc-plugin --ci
git status --short
```

Expected:

- `npm run check`: 0 errors, all files formatted.
- `npm test`: 100% green (including `test/cli/npm-pack.test.js` `< 75 MB`).
- `pytest`: all Python tests pass.
- `hermes plugins doctor apple-doc-plugin --ci`: exit `0`, reports `6 tool(s)` + registered skill cleanly.
- `git status --short` after running `npm run doctor`: clean working tree (`data/apple-docs.db` untouched!).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/search/semantic-search.ts plugin.yaml plugin.json bridges/hermes/__init__.py test/unit/similarity-thresholds.test.js test/python/test_hermes_registration.py test/python/test_hermes_manifest.py
git commit -m "feat(hermes,search): calibrate Gemini RRF floor, align manifests, and register apple-docs skill"
```
