# Apple Developer Documentation MCP Server & Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-1.27.1-purple.svg)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)

Offline-first [MCP](https://modelcontextprotocol.io) server (and Antigravity plugin) for Apple Developer Documentation.

Local SQLite FTS5 over 65,787 symbols across SwiftUI, UIKit, Foundation, SwiftData, Combine, AppKit, Swift Standard Library, Observation, and CoreLocation. Optional Gemini embeddings for conceptual / visual queries. DocC JSON rendered to Markdown agents can actually use.

**Two modes, same binary:**

| Mode        | What you need                             | What you get                                                                                            |
| ----------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Offline** | Node 22+ and `data/apple-docs.db`         | Fast BM25 + wildcard symbol search, local docs, CDN fallback only when a symbol is missing              |
| **Hybrid**  | Local GGUF (`embeddinggemma-2`) or Gemini | Same lexical path, plus vector search, RRF fusion, and UI-layout preview cards (100% offline with GGUF) |

No API key? It still works offline without a key. That is the point.

## Why this exists

Coding agents hallucinate deprecated Apple APIs. Live doc scrapers are accurate until the CDN rate-limits you. This repo keeps a local index for the hot path and only hits Apple or Gemini when it has to.

Ships with:

- `search_symbols` — lexical FTS5 search with exact-name boost, universal wildcard globbing (`Grid*`, `*Style`, `Navigation*View`), kind aliasing (`func` matches DocC `method`), runnable copy-paste `get_documentation` calls, and optional framework / platform filters (never calls Gemini)
- `semantic_search` — natural-language / behavioral queries (hybrid vector + FTS5 with guard against demoting exact symbols on sparse embeddings; falls back to lexical if Gemini credentials are not configured or circuit breaker trips)
- `get_documentation` — point lookup by symbol title (`NavigationStack`) or path (`/documentation/swiftui/view`), with disambiguation candidate list for colliding names, and clean error flags on missing symbols
- `discover_technologies` — database-backed discovery listing indexed frameworks with exact symbol counts and valid tool call pagination
- `index_info` / `get_version` — inspect runtime SQLite database status, symbol count, and freshness
- Antigravity **skill + rules** that tell the agent to verify APIs and prefer `NavigationStack`, `@Observable`, SwiftData, Swift Concurrency

## Prior art

The MCP tool shape (discover / choose technology, symbol search, get documentation) follows the path opened by [MightyDillah/apple-doc-mcp](https://github.com/MightyDillah/apple-doc-mcp). That server talks to Apple’s live documentation. This project is a separate codebase: local FTS5 index, hybrid ranking, DocC formatter, and Antigravity plugin packaging.

If you want always-fresh docs and `npx` with no native addon, use that one. If you want offline lookup + ranking + agent rules, use this one.

## Requirements

- **Node.js 22+** (uses `process.loadEnvFile`; badge is not decorative)
- A working C/C++ toolchain the first time `better-sqlite3` compiles (native addon; see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md))
- Optional: Gemini API key or `gcloud auth application-default login`

```bash
node -v   # >= 22
npm install
npm run build
```

## Install

### Hermes Agent plugin (Native)

Install directly into Hermes Agent via CLI or catalog:

```bash
hermes plugins install https://github.com/AndrewMason7/apple-doc-plugin.git
hermes plugins enable apple-doc-plugin
```

This uses native Hermes manifest v2 (`plugin.yaml`) and exposes `search_symbols`, `semantic_search`, `get_documentation`, `discover_technologies`, `get_version`, and `index_info` directly in Hermes conversations.

### Antigravity plugin

```bash
agy plugin install .
# or
agy plugin install AndrewMason7/apple-doc-plugin
agy plugin validate .
```

That registers the MCP server (`bin/launcher.cjs`), the `apple-docs` skill, and `rules/AGENTS.md`.

### Claude Code / Cursor / Windsurf / Codex

Build first, then point MCP at the compiled entrypoint. Gemini env is optional.

```json
{
	"mcpServers": {
		"apple-docs": {
			"command": "node",
			"args": ["/absolute/path/to/apple-doc-plugin/dist/index.js"],
			"env": {
				"GEMINI_API_KEY": "YOUR_GEMINI_API_KEY"
			}
		}
	}
}
```

Omit `GEMINI_API_KEY` for offline-only. You can also run `bin/launcher.cjs` if you installed the plugin layout.

> Package name on npm is `apple-doc-plugin`. Do **not** `npx apple-doc-mcp-server` and assume it is this repo — that name already belongs to MightyDillah’s live server.

## Tools

Use the smallest tool that answers the question.

| Tool                         | Use when                                                                                | Notes                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `semantic_search`            | You know the _behavior_ or UI concept, not the symbol (`"prevent sheet swipe dismiss"`) | Preferred for agents. Needs Gemini for the vector half; lexical still runs if the circuit breaker is open or creds missing. Guards against demoting symbols when vectors are sparse (<100 items). |
| `search_symbols`             | You know a name or pattern (`Grid*`, `*Style`, `Navigation*View`)                       | Always purely local lexical. Exact title match gets a large score boost. Includes runnable copy-paste `get_documentation` calls and kind aliases (`symbolType: "func"` matches `method`).         |
| `get_documentation`          | You already have a symbol or DocC path (`NavigationStack`, `SwiftUI/View`)              | Point lookup: local SQLite first, Apple DocC CDN if missing. Resolves by title or path. Returns disambiguation candidates if ambiguous and `isError: true` if unresolvable.                       |
| `discover_technologies`      | You need the list of indexed frameworks                                                 | Database-backed discovery showing exact symbol counts per framework with valid tool JSON pagination.                                                                                              |
| `get_version` / `index_info` | You want server version or snapshot freshness                                           | Reports runtime symbol count, indexed frameworks, snapshot build timestamp, and embedding availability.                                                                                           |

### Agent examples

```json
semantic_search({ "query": "prevent user from dragging sheet down to close", "framework": "SwiftUI" })
semantic_search({ "query": "three column sidebar split view diagram", "framework": "SwiftUI" })

search_symbols({ "query": "Grid*" })
search_symbols({ "query": "*Style", "framework": "SwiftUI" })
search_symbols({ "query": "Navigation*View", "framework": "SwiftUI" })
search_symbols({ "query": "interactiveDismissDisabled", "symbolType": "func" })

get_documentation({ "path": "NavigationStack" })
get_documentation({ "path": "Button", "framework": "SwiftUI" })
get_documentation({ "path": "/documentation/swiftui/view" })
```

## How search works

```
query
  ├─ sanitize / clamp / escape FTS
  ├─ lexical: SQLite FTS5 BM25 (+100 exact-title boost)
  └─ optional semantic: gemini-embedding-2 (3072-d), cosine vs precomputed L2 norms
        └─ skip on missing creds, 401/403/429/5xx/timeout (30s circuit breaker)
fuse with Reciprocal Rank Fusion (k = 60)
optional suffix-wildcard rerank (types & protocols first)
attach visual preview markdown when a media hit exists
slice to maxResults
```

`get_documentation` does not go through that fusion path. It is a point lookup: local row → else CDN → DocC AST formatter → Markdown.

## Refresh the index

The shipped `data/apple-docs.db` is a snapshot (~99,903 symbols across SwiftUI, UIKit, Foundation, SwiftData, Combine, AppKit, Observation, CoreLocation). It goes stale when Apple ships new APIs.

```bash
cp .env.example .env          # optional; add GEMINI_API_KEY to also rebuild vectors
npm run build:index
```

What `build:index` does:

1. Open SQLite in WAL mode, ensure tables + FTS5 exist
2. For each configured framework, pull the symbol tree + overview DocC from Apple’s CDN
3. Upsert symbols and abstracts
4. If an embedding provider is available: embed framework overviews, referenced UI media, **and the symbol layer** (`title`, kind, framework, abstract) — the symbol vectors are what `semantic_search` actually needs
5. If not: log that this pass is FTS5-only
6. `INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild')`
7. `PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM`

Expect this to take a while and to hit Apple’s CDN. Hybrid rebuilds also cost Gemini embeddings. Run it on a machine with network, then copy the db if you want.

Override the db location with `APPLE_DOCS_DB_PATH`.

## Enable hybrid search with a local model

Hybrid search needs **100+** semantic items. The symbol layer is what gets you
there, and it can be built with a local EmbeddingGemma GGUF — no API key, no
per-token cost:

```bash
# 1. Place the model (309 MB) where the server looks for it by default
mkdir -p ~/.cache/apple-docs/models
hf download unsloth/embeddinggemma-2-GGUF embeddinggemma-2-Q8_0.gguf \
  --local-dir ~/.cache/apple-docs/models

# 2. Embed the symbol layer (resumable — re-run to continue)
npm run embed-index                 # primary types + documented symbols
npm run embed-index -- --enrich     # fetch missing abstracts first (better recall)
npm run embed-index -- --limit 25   # smoke test
npm run embed-index -- --all        # every symbol (slow, exhaustive)
```

Override the model location with `APPLE_DOCS_EMBEDDING_MODEL_PATH`. Provider
precedence: an available local GGUF wins; Gemini (API key or ADC) is the
fallback; `APPLE_DOCS_EMBEDDING_PROVIDER=gemini` forces Gemini.

### Truncating vector size (MRL)

Gemini's embedding family supports Matryoshka truncation, and the API re-normalises
truncated output, so direction — which is all cosine similarity uses — is preserved.
Google's own MTEB numbers put 768 dims within ~0.2 points of 1536, at a quarter of the
storage of the 3072 default:

```bash
APPLE_DOCS_EMBEDDING_DIMENSIONS=768   # 128 | 256 | 512 | 768 | 1024 | 1536 | 2048 | 3072
npm run embed-index -- --force         # re-embed: existing vectors are the old shape
```

Changing the dimension count invalidates every stored vector (a 768-d query cannot be
scored against a 3072-d corpus), so clear `semantic_items` or run `--force` and verify
`get_version` before trusting results. Unsupported values are ignored rather than
guessed, so you keep the native 3072 instead of writing incomparable vectors.

The similarity floor is per-provider, not inherited from Gemini: the local GGUF
uses **0.68** (0.62 when a caller prefers semantic matches), because measured on
Apple symbol text, on-topic pairs score 0.688-0.719 while unrelated pairs top out
near 0.66 — Gemini's 0.65 floor let that noise through. See
`resolveMinSimilarity()` in `hybrid-search.ts`.

Progress is reported per batch, and completed items are skipped on the next run,
so an interrupted embedding pass costs nothing. `get_version` flips from
`Lexical only` to `Hybrid` once the threshold is crossed — restart the MCP
server afterwards so the new vectors are loaded.

## Repair an existing index (no re-crawl)

`build:index` re-downloads everything. When a snapshot has classification
defects — unclassified symbol kinds, or rows attributed to the wrong framework —
repair them in place instead:

```bash
npm run repair-index            # dry run: shows what would change
npm run repair-index -- --apply # writes, rebuilds FTS5, stamps repaired_at
```

`repair-index` does two things:

1. **Framework attribution** — any row whose `framework` column contradicts the
   framework segment of its own path is re-attributed (`/documentation/uikit/nsview`
   filed under `Foundation` becomes `UIKit`).
2. **Symbol kinds** — rows stored with the generic `symbol`/`unknown` kind are
   re-fetched from Apple's DocC CDN and written back from the authoritative
   `metadata.symbolKind` / `metadata.roleHeading`. Responses are cached under
   `.cache/repair/`, so repeat runs are free.

Both counts are reported by the `index_info` tool under **Index Health**.

## Reading the status tools honestly

| Tool | Answers | Key fields |
|---|---|---|
| `get_version` | what is this server | version, symbol count, **real** search mode, freshness + provenance |
| `index_info` | can I trust this index | kind distribution, unclassified count, framework/path mismatches, filter reliability |

`Search Capability` reports `Lexical only` until at least **100** semantic items
exist, because the hybrid engine refuses to fuse vectors below that threshold.
A non-empty `semantic_items` table is *not* the same claim as hybrid search, and
the status line says so.

`symbolType` filters never silently relax: if a filter matches nothing, the
response states that the results are **UNFILTERED**. Rows without a classified
kind are shown as `Kind: unknown` — never as `symbol` — and never satisfy a
concrete kind filter.

## Environment

```bash
cp .env.example .env
```

| Variable                          | Required | Purpose                                                                                        |
| --------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `APPLE_DOCS_EMBEDDING_MODEL_PATH` | No       | Local path to `embeddinggemma-2-Q8_0.gguf` for 100% offline in-process Metal vector embeddings |
| `APPLE_DOCS_EMBEDDING_PROVIDER`   | No       | Force provider: `local` (in-process GGUF) or `gemini` (cloud API)                              |
| `GEMINI_API_KEY`                  | No       | Gemini embeddings (`gemini-embedding-2`). [Google AI Studio](https://aistudio.google.com/)     |
| `GOOGLE_APPLICATION_CREDENTIALS`  | No       | Service-account JSON for ADC. `gcloud auth application-default login` also works               |
| `APPLE_DOCS_DB_PATH`              | No       | Alternate path to the SQLite file (default `data/apple-docs.db`)                               |

The process loads `.env` at startup. Credentials are not logged.

## Layout

```
apple-doc-plugin/
├── bin/launcher.cjs          # Antigravity bootstrap
├── data/apple-docs.db        # FTS5 + optional vectors
├── rules/AGENTS.md           # modern Apple API rules for agents
├── skills/apple-docs/        # skill + workflow
├── scripts/build-index.ts    # corpus rebuild
├── src/
│   ├── index.ts              # stdio MCP entry
│   ├── apple-client/         # HTTP + DocC AST → Markdown
│   └── server/
│       ├── handlers/         # one handler per tool
│       ├── services/         # hybrid / semantic / resolution
│       └── db/               # SQLite access
└── test/
```

## Development

```bash
npm install
npm run build
npm test              # Node native runner; currently 82 tests
npm run check         # tsc --noEmit + prettier
npm run format
npm run build:index   # rebuild the snapshot (network)
```

`better-sqlite3` will compile on install. If that fails, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — you are missing platform build tools, not an MCP bug.

## Limitations (read this)

- The snapshot is **not** the entire Apple documentation corpus. Niche frameworks may miss. `get_documentation` can still fall back to the live DocC CDN for a known path.
- Hybrid quality depends on whatever was embedded the last time you ran `build:index` with Gemini credentials.
- Visual previews are derived from media references in Apple’s docs. Treat them as lookup aids, not a HIG replacement.
- Native addon (`better-sqlite3`) requires C++ compilation tools during install.

## License

[MIT](LICENSE) © 2026 Andrew Mason
