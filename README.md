# Apple Developer Documentation MCP Server & Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-1.27.1-purple.svg)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)

Offline-first [MCP](https://modelcontextprotocol.io) server (and Antigravity plugin) for Apple Developer Documentation.

Local SQLite FTS5 over ~99,903 symbols across SwiftUI, UIKit, Foundation, SwiftData, Combine, AppKit, Observation, and CoreLocation. Optional Gemini embeddings for conceptual / visual queries. DocC JSON rendered to Markdown agents can actually use.

**Two modes, same binary:**

| Mode        | What you need                            | What you get                                                                               |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Offline** | Node 22+ and `data/apple-docs.db`        | Fast BM25 + wildcard symbol search, local docs, CDN fallback only when a symbol is missing |
| **Hybrid**  | Offline + `GEMINI_API_KEY` or Google ADC | Same lexical path, plus vector search, RRF fusion, and UI-layout preview cards             |

No API key? It still works offline without a key. That is the point.

## Why this exists

Coding agents hallucinate deprecated Apple APIs. Live doc scrapers are accurate until the CDN rate-limits you. This repo keeps a local index for the hot path and only hits Apple or Gemini when it has to.

Ships with:

- `search_symbols` — lexical FTS5 search with exact-name boost, `*` / `?` wildcards, optional framework / platform / type filters (never calls Gemini)
- `semantic_search` — natural-language / behavioral queries (hybrid vector + FTS5; falls back to lexical if Gemini credentials are not configured or circuit breaker trips)
- `get_documentation` — point lookup converting DocC AST → Markdown (declarations, parameters, deprecation callouts, discussion)
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

| Tool                                       | Use when                                                                                | Notes                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `semantic_search`                          | You know the _behavior_ or UI concept, not the symbol (`"prevent sheet swipe dismiss"`) | Preferred for agents. Needs Gemini for the vector half; lexical still runs if the circuit breaker is open or creds missing. |
| `search_symbols`                           | You know a name or pattern (`Grid*`, `*Style`)                                          | Always purely local lexical. Exact title match gets a large score boost. Does not call Gemini.                              |
| `get_documentation`                        | You already have a symbol or DocC path                                                  | Point lookup: local SQLite first, Apple DocC CDN if missing. `framework` disambiguates collisions.                          |
| `discover_technologies`                    | You need the list of indexed frameworks                                                 | Filter with `query`.                                                                                                        |
| `choose_technology` / `current_technology` | You want an optional session-wide default framework                                     | Optional. Prefer passing `framework` directly on each tool call instead.                                                    |
| `get_version` / `index_info`               | You want server version or snapshot freshness                                           | Reports runtime symbol count, indexed frameworks, snapshot build timestamp, and embedding availability.                     |

### Agent examples

```json
semantic_search({ "query": "prevent user from dragging sheet down to close", "framework": "SwiftUI" })
semantic_search({ "query": "three column sidebar split view diagram", "framework": "SwiftUI" })

search_symbols({ "query": "Grid*" })
search_symbols({ "query": "*Style", "framework": "SwiftUI" })
search_symbols({ "query": "View", "platform": "iOS", "symbolType": "protocol" })

get_documentation({ "path": "NavigationStack", "framework": "SwiftUI" })
get_documentation({ "path": "documentation/swiftui/view" })
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
4. If Gemini auth is present: embed documents (asymmetric title/abstract prompts) and referenced UI media
5. If not: log that this pass is FTS5-only
6. `INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild')`
7. `PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM`

Expect this to take a while and to hit Apple’s CDN. Hybrid rebuilds also cost Gemini embeddings. Run it on a machine with network, then copy the db if you want.

Override the db location with `APPLE_DOCS_DB_PATH`.

## Environment

```bash
cp .env.example .env
```

| Variable                         | Required | Purpose                                                                                    |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `GEMINI_API_KEY`                 | No       | Gemini embeddings (`gemini-embedding-2`). [Google AI Studio](https://aistudio.google.com/) |
| `GOOGLE_APPLICATION_CREDENTIALS` | No       | Service-account JSON for ADC. `gcloud auth application-default login` also works           |
| `APPLE_DOCS_DB_PATH`             | No       | Alternate path to the SQLite file (default `data/apple-docs.db`)                           |

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
- `choose_technology` is optional session state. Prefer passing `framework` directly on the tool call.

## License

[MIT](LICENSE) © 2026 Andrew Mason
