# Runtime DB Hydration, Model Provenance & Hermes Surface Alignment — Design Spec

**Date:** 2026-11-10
**Target Version:** `apple-doc-plugin` 1.0.4
**Status:** Draft for Review

## 1. Problem Statement

Live capability and packaging audits of `apple-doc-plugin` v1.0.3 surfaced four concrete defects:

1. **In-place mutation of git-tracked `data/apple-docs.db`:** `autoImportBundledVectors` (`src/server/app.ts:74`, `src/server/handlers/search-symbols.ts:229`) imports `19,473` vectors directly into tracked `data/apple-docs.db`, inflating it from `48 MB` to `185 MB` (+ WAL). This:
   - Permanently dirties `git status` (`M data/apple-docs.db`) on first server boot, blocking clean `git pull` and `hermes plugins update`.
   - Breaks `test/cli/npm-pack.test.js` (`Tarball size 177638275 exceeds 75 MB limit`) because `package.json` `"files"` packs both `data/apple-docs.db` and `assets/apple-docs-vectors-768d.db.gz`.
   - Fails with `EACCES` if installed into a read-only prefix (global root `node_modules` or Homebrew Cellar).
2. **Cold-start status race:** `autoImportBundledVectors` in `createServer()` is fire-and-forget. Calling `get_version` or `index_info` during the ~5-second decompression window reports `Lexical only — 0 semantic items; run "npm run download-vectors"` while background hydration is actively running.
3. **Untracked 768-d embedding model provenance:** Both `gemini-embedding-2` (MRL 768-d) and `embeddinggemma-2` (local GGUF 768-d) emit 768-dimensional vectors in incompatible latent spaces. Neither SQLite `meta` nor `assets/apple-docs-vectors-768d.db.manifest.json` records the model identifier, so `storedWidth === queryWidth` (`768 === 768`) silently admits cross-model cosine garbage when a user switches `APPLE_DOCS_EMBEDDING_PROVIDER`.
4. **RRF floor drift & manifest/Hermes surface gaps:**
   - `GeminiSemanticSearch` relies on the fallback `minSimilarityPreferred = 0.55`, admitting weak cosine distractors (e.g., `swipeActionsContainer()`) that fuse with lexical BM25 hits to outrank `interactiveDismissDisabled(_:)` on `"prevent sheet swipe dismiss"`.
   - `plugin.yaml` and `plugin.json` advertise `"multimodal UI layout previews"`, whereas the shipped vector bundle contains `0` rows with `media_url`.
   - `skills/apple-docs/SKILL.md` ships in the package, but `bridges/hermes/__init__.py` never calls `ctx.register_skill(...)`, leaving `apple-doc-plugin:apple-docs` invisible to Hermes `<available_skills>` and `skill_view`.

## 2. Architecture & Design Decisions

### 2.1 Immutable Seed DB vs. Writable Runtime DB (`src/server/db/db-path.ts`)

- **`data/apple-docs.db` becomes an immutable lexical seed** (`SEED_DB_RELATIVE_PATH = 'data/apple-docs.db'`), written exclusively by `scripts/build-index.ts` via `resolveSeedDbPath()` and packed into npm (`< 75 MB` tarball ceiling preserved permanently).
- **`resolveDbPath()` resolves the active runtime DB** shared across `app.ts`, `doctor.ts`, `download-vectors.ts`, `embed-index.ts`, and `repair-index.ts`:
  1. Explicit `APPLE_DOCS_DB_PATH` (including `${extensionPath}` and `:memory:` / `file::memory:`) wins unchanged.
  2. Otherwise, if `<PROJECT_ROOT>/data` is writable (`fs.constants.W_OK`), returns `<PROJECT_ROOT>/data/apple-docs.runtime.db` (ignored by `.gitignore` and excluded from `package.json` `"files"`).
  3. Otherwise (read-only system/Homebrew prefix), returns `${XDG_CACHE_HOME || ~/.cache}/apple-docs/apple-docs.runtime.db`.
- **`ensureRuntimeDbSeeded()`** atomically copies `resolveSeedDbPath()` → `resolveDbPath()` (via `${target}.seed.${process.pid}.tmp` + `renameSync`, removing any stale `${target}-wal` / `${target}-shm` before rename) when:
  - `APPLE_DOCS_DB_PATH` is unset, AND
  - the runtime DB is missing OR its SQLite `meta.built_at` differs from the seed DB's `meta.built_at` (so `git pull` / package upgrades refresh stale runtime copies automatically).

### 2.2 Hydrating State Visibility

- `download-vectors.ts` exports `isAutoImportInFlight(): boolean`.
- When `semanticItemCount === 0 && isAutoImportInFlight()`, `get_version`, `index_info`, and `runDoctor` report an explicit `hydrating` state (`Hydrating bundled 768-d vectors in background — retry in a few seconds`) with `0` false setup warnings.

### 2.3 Embedding Model Provenance Guard

- `EmbeddingProvider` adds `readonly modelId: string` (`'gemini-embedding-2'` for Gemini default or configured model slug, `'embeddinggemma-2'` for local GGUF, `'none'` for unavailable).
- `embedSymbols()` writes `meta.embedding_model = provider.modelId` and `meta.embedding_provider = provider.id`; if `--force` is omitted and existing `meta.embedding_model` mismatches `provider.modelId` while `semanticItemCount > 0`, `embedSymbols()` throws a clear error requiring `--force` so mixed-model corpora cannot be created accidentally.
- `exportVectors()` writes `embedding_model` and `embedding_provider` to both exported SQLite `meta` and `VectorPackageManifest` (`formatVersion: 2`, backward-compatible reader for `formatVersion: 1`).
- `importVectorsFromDb()` copies `embedding_model` and `embedding_provider` from the vector bundle's `meta` (defaulting to `'gemini-embedding-2'` / `'gemini'` when importing the pinned `VECTOR_ARTIFACT_SHA256` v1 bundle).
- `HybridSearchEngine`, `version.ts`, `search-symbols.ts`, and `doctor.ts` compare normalized `storedModel` vs `provider.modelId`: on mismatch, cosine scoring is skipped once with a deduplicated warning, search emits an explicit lexical-fallback model-mismatch banner, and status/doctor surfaces report the exact fix (`APPLE_DOCS_EMBEDDING_PROVIDER=...` or `npm run embed-index -- --force`).

### 2.4 RRF Preferred Cosine Floor, Manifest Copy & Hermes Skill Wiring

- Set `GeminiSemanticSearch.minSimilarityPreferred = 0.62` (above sub-0.62 lexical distractors while safely below every true behavioral hit in `docs/benchmarks/results.json`, minimum `0.66+`).
- Update `plugin.yaml` and `plugin.json` descriptions to replace `"multimodal UI layout previews"` with `"hybrid semantic & cross-framework idiom search"`.
- In `bridges/hermes/__init__.py` `register(ctx)`, invoke `ctx.register_skill("apple-docs", skill_path, description=...)` when `hasattr(ctx, "register_skill")` and `skills/apple-docs/SKILL.md` exists.

## 3. Non-Goals (Deferred to Separate Corpus Plan)

- Crawling and embedding the remaining ~76k symbols in `Security`, `RealityKit`, `AVFoundation`, `Vision`, and `StoreKit` (requires upstream API crawl + regenerating and re-uploading the 55 MB `.db.gz` artifact).
- Per-symbol DocC availability backfill for `FRAMEWORK_DEFAULT_PLATFORMS` reference rows.
