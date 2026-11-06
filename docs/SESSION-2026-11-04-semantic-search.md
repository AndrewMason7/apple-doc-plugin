# Session record — 2026-11-04

**Subject:** apple-doc-plugin — from "status tools that lie" to a working hybrid semantic index
**Branch:** `fix/index-truthfulness` → PR [#2](https://github.com/AndrewMason7/apple-doc-plugin/pull/2)
**Base:** `hermes_sdk_plugin_native` @ `08b90c7` · **Head:** `0088e19`

---

## 1. How this started

A smoke test of all six MCP tools. Everything responded, so the surface looked
healthy — which is exactly why the defects were worth hunting. Three status
claims were false, two data defects silently corrupted filtering, and the
advertised "hybrid semantic search" had never been able to run at all.

The audit rule that found them: **treat every advertised capability as a claim
to falsify, and query the backing store instead of trusting the tool that
describes it.**

---

## 2. Defects found

| #   | Defect                                                                                                                                                                                                         | Evidence                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `get_version` claimed **"Embeddings Present: Yes (hybrid multimodal search enabled)"** while `semantic_search` printed `Lexical fallback (semantic index has 24 items; symbol embeddings require build:index)` | `hasEmbeddings()` returned `count > 0`; the search path refuses to fuse below `MIN_SEMANTIC_ITEMS_FOR_HYBRID = 100`. The two tools disagreed by construction.                                                 |
| 2   | `symbolType` filters **silently relaxed**                                                                                                                                                                      | `View` (a protocol) and `ModelContainer` (a class) were stored as `kind='symbol'`, so `symbolType: "protocol"` matched 0 rows and then returned _unfiltered_ results with only a footnote. 173 rows affected. |
| 3   | Framework attribution **contradicted the row's own path**                                                                                                                                                      | `/documentation/uikit/nsview` filed under `Foundation`; the `SwiftUI` technology row filed under `AppKit`. Produced cross-framework false positives _and_ framework-scoped false negatives. 273 rows.         |
| 4   | Freshness **unmeasurable**                                                                                                                                                                                     | `meta.built_at` was never written into the shipped snapshot → `Not recorded in snapshot`, no provenance.                                                                                                      |
| 5   | `index_info` was a **byte-identical duplicate** of `get_version`                                                                                                                                               | no distinct payload for a distinct tool                                                                                                                                                                       |
| 6   | **The hybrid path was unreachable by design**                                                                                                                                                                  | `build:index` embedded only framework overviews (8) and media previews → `semantic_items` could never reach 100. The documented "rebuild to enable hybrid" advice was a dead end.                             |

Defects 1–2 were visible from the tool surface. 3–6 came only from querying
SQLite and reading the ingest/search source.

---

## 3. Work performed, in order

### 3.1 Honest status (`42b7b93`)

- `MIN_SEMANTIC_ITEMS_FOR_HYBRID` exported; `getEmbeddingStatus()` returns
  `{ semanticItemCount, threshold, hybridEnabled, mode, storageHasVectors }`.
- `get_version` prints the **real** mode:
  `Lexical only (SQLite FTS5) — 24 of 100 semantic items embedded`.
- `index_info` became a distinct **index health** report: kind distribution,
  unclassified count, framework/path mismatches, freshness provenance, filter
  reliability.
- Freshness falls back to the db file mtime **and names that provenance**.

### 3.2 Kinds and attribution (`42b7b93`)

- `resolveSymbolKind()` derives kinds from `metadata.symbolKind` → `roleHeading`
  → `kind`; with no authority the answer is `unknown`, never `symbol`.
- The `insertSymbol` upsert no longer downgrades a classified kind to an
  unclassified one, so a page-reference pass cannot clobber the navigation tree.
- `symbolType` filters never silently relax: 0 matches prints **UNFILTERED**;
  unknown-kind rows render as `Kind: unknown` and can be requested explicitly.
- `path-attribution.ts` parses `doc://` identifiers, `/documentation/…`,
  `documentation/…`, `swiftui/view` and bare `uikit`; unrecognised slugs keep the
  caller's fallback instead of inventing a name.
- `npm run repair-index` (dry-run by default, `--apply` to write): re-attributes
  rows from their paths and backfills kinds from Apple's DocC metadata (cached
  under `.cache/repair/`), rebuilds FTS5 and stamps `repaired_at`.
- Applied to the shipped snapshot: **273 framework fixes, 173 kind fixes** →
  `unclassified: 0`, `framework/path mismatches: 0`.

### 3.3 The symbol embedding pipeline (`9ba7c0f`)

`build:index` embedded framework cards and media only. Added:

- `symbol-embeddings.ts` — `buildSymbolEmbeddingText`, `selectEmbeddingCandidates`,
  `embedSymbols` (resumable by semantic id, limitable, injectable provider).
- `npm run embed-index` with `--enrich`, `--limit`, `--all`, later `--force`.
- `build:index` now embeds the symbol layer and records `semantic_item_count`.

### 3.4 Member enrichment (`2437079`)

Apple's overview pages document top-level types only. Measured: **13,590**
SwiftUI/UIKit methods, properties and initialisers had **no abstract**, and only
**2 of 1,005** SwiftUI view modifiers were described. `--enrich-scope members`
routes the enrichment pass at those rows; it filled **13,896 abstracts** total.

### 3.5 Per-provider similarity floors (`2374603`)

The engine hardcoded Gemini's 0.65/0.55 cosine floors for every provider.
Measured on the corpus with EmbeddingGemma 2 Q8_0: on-topic pairs
**0.6887–0.7194**, unrelated pairs **0.5520–0.6601**. Providers now declare
their own floors (local `0.68/0.62`, gemini `0.65/0.55`) resolved by
`resolveMinSimilarity()`.

### 3.6 Gemini batching + breaker retry (`8eb1a74`)

- Single-threaded Gemini ran at 2.3 docs/s ≈ 2.4 h for 19,473 symbols.
- `:batchEmbedContents` (100 requests/call) → **~45–55/s**, ~6 min.
- **First bulk run lost 18,173 items**: one transient 429 tripped the 30 s
  circuit breaker and every later chunk short-circuited _before_ its HTTP call,
  so the loop "finished" in 34 s with 1,300 successes at a fake 590/s.
- Fixed with `withRetry()` (exponential backoff, attempt budget, `shouldRetry`
  so 4xx other than 429 fails fast) and `waitForCircuitClosed()` (a bulk run
  waits out the breaker instead of hammering a closed gate). A failed slot still
  falls back to a single `embedDocument` call.

### 3.7 MRL truncation (`0088e19`)

Google's published MTEB table for `gemini-embedding-2`: **768 → 67.99**,
1536 → 68.17, 2048 → 68.16. Truncating 3072 → 768 therefore costs ~0.2 points
for a quarter of the footprint. `gemini-embedding-2` re-normalises truncated
output itself, so no manual L2 pass is needed.

`SUPPORTED_EMBEDDING_DIMENSIONS = [128, 256, 512, 768, 1024, 1536, 2048, 3072]`,
`resolveRequestedDimensions()` parses `APPLE_DOCS_EMBEDDING_DIMENSIONS` and
**ignores unsupported values** rather than guessing.

---

## 4. Measured results

### Index

| metric                    | before           | after                             |
| ------------------------- | ---------------- | --------------------------------- |
| symbols                   | 65,787           | 65,787                            |
| unclassified kinds        | 173              | **0**                             |
| framework/path mismatches | 273              | **0**                             |
| semantic items            | 44               | **19,473**                        |
| vector dims               | —                | 768 (configurable, default 3072)  |
| db size                   | 30 MB            | **108 MB** (was 270 MB at 3072-d) |
| search mode               | "hybrid" (lying) | **hybrid (true)**                 |

### Retrieval quality — same query, three configurations

> "code that runs once the screen shows up"

| rank | EmbeddingGemma 2 270M (768-d) | Gemini 3072-d       | **Gemini 768-d (shipped)** |
| ---- | ----------------------------- | ------------------- | -------------------------- |
| 1    | `main()`                      | `viewDidLoad()`     | **`viewDidLoad()`**        |
| 2    | `show()`                      | `documentDidOpen()` | **`documentDidOpen()`**    |
| 3    | `didActivateNotification`     | `viewDidAppear()`   | **`viewDidAppear()`**      |
| 4    | `progressHandler`             | `viewIsAppearing()` | **`viewIsAppearing()`**    |
| 5    | `mirrored`                    | `viewWillAppear()`  | **`viewWillAppear()`**     |

Cosine detail: `onAppear` 0.6887 → **0.7044**; `task` 0.6365 → **0.6447**;
noise `main()` 0.7926 → 0.6576. 3072-d and 768-d produce an **identical**
top-10 ordering.

Also verified: _"prevent a sheet from being dismissed by swiping down"_ →
`interactiveDismissDisabled` at rank 2.

### Throughput

| path                                  | rate        | wall clock |
| ------------------------------------- | ----------- | ---------- |
| VPS, contended (AIDE scan, load 13.4) | 0.43/s      | hours      |
| Mac, Metal (EmbeddingGemma)           | 32.8/s      | ~10 min    |
| Gemini single-threaded                | 2.3/s       | 2.4 h      |
| **Gemini batched**                    | **43–55/s** | **~6 min** |

---

## 5. Mistakes made in this session (all corrected in-repo)

1. **"The classification headline dilutes short abstracts"** — plausible, and
   wrong. With the headline `task` scored 0.6725 / noise 0.7666; without it
   `task` scored 0.6665 / noise 0.7926. The change was kept only for fidelity to
   Apple's text; the commit message states the hypothesis was **rejected**.
2. **"Batching failed 18,173 items — must be the payload"** — no. Both the
   deprecated top-level fields and `embedContentConfig` return 200. The failure
   was the circuit breaker tripping on one 429 and short-circuiting the rest.
3. **"Hybrid is enabled"** in the shipped code — the original defect. A counter
   is not a capability.

Two operational traps worth remembering: `pkill -f <plugin-path>` kills the
invoking shell (the pattern matches its own argv), and copying a WAL-mode SQLite
file without `PRAGMA wal_checkpoint(TRUNCATE)` silently loses recent writes
(6,963 → 6,787 in one measured round-trip).

---

## 6. Reproduce an identical index from scratch

```bash
cd apple-doc-plugin
cp .env.example .env                      # GEMINI_API_KEY=... (or use a local GGUF)
npm install && npm run build
npm run repair-index -- --apply           # kinds + attribution, no re-crawl
npm run embed-index -- --enrich --enrich-scope members   # abstract backfill + vectors
```

Approximate cost from a clean snapshot: ~16 min of DocC enrichment, ~6 min of
batched Gemini embeddings for 19,473 symbols, and a few pence of API usage.

Configuration used:

```
APPLE_DOCS_EMBEDDING_PROVIDER=gemini
APPLE_DOCS_EMBEDDING_DIMENSIONS=768
GEMINI_API_KEY=<rotated>
```

---

## 7. Verification status

- **154 tests · 151 pass · 0 fail · 3 skipped** (the 3 skipped are hardcoded
  `/Users/andrew/...gguf` local-model tests that now skip on hosts without that
  path instead of failing).
- Live MCP verification after every change: `get_version` reports the true mode,
  `index_info` reports a clean index, `symbolType` filters return the right
  kinds, and semantic queries return the correct API family.
- DB snapshots taken before every destructive step under
  `~/.hermes/cache/scratch/apple-docs-backup/`.

---

## 8. Known limits / possible next steps

- **Terse abstracts are the ceiling.** Apple gives one line per symbol; the
  ranking quality is bounded by that text, not by the threshold. Lowering the
  floor admits the noise band (only 39 of 19,473 vectors clear 0.68 at 768-d
  with Gemini's compressed score range).
- **The 24 technology/media vectors were dropped** when switching dimension
  families (768 ⇄ 3072 cannot coexist). `npm run build:index` recreates them.
- **`get_documentation`'s live-DocC fallback** can still surface a
  cross-framework _reference_ (e.g. `SwiftUI` resolved while scoped to `AppKit`).
  That comes from Apple's reference graph, not from the index.
- **No CI workflow** is wired for the new scripts; they are covered by unit
  tests with injected providers, but not by an end-to-end fixture.
