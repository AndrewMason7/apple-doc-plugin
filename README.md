# Apple Developer Documentation MCP Server & Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-1.27.1-purple.svg)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)

**High-performance MCP server and Antigravity/Hermes plugin featuring Hybrid Semantic Search and offline Apple Developer Documentation.**

Gives coding agents (Claude Code, Cursor, Windsurf, Antigravity, Hermes) deep understanding of Apple frameworks — allowing agents to search by **natural-language behavior, concepts, and intent**, not just exact symbol names.

---

### Highlights

- 🧠 **Hybrid Semantic Search**: Combines dense vector embeddings with SQLite FTS5 BM25 via **Reciprocal Rank Fusion (RRF)**. Finds the right APIs even when your query shares zero words with the symbol name.
- ⚡ **65,787 Symbols Offline**: Ships with a pre-indexed database spanning SwiftUI, UIKit, Foundation, SwiftData, Combine, AppKit, Swift Standard Library, Observation, and CoreLocation.
- 🎯 **Dual Semantic Engines**: Run hosted embeddings with **Google Gemini** (`gemini-embedding-2`) or **100% offline** on Apple Silicon Metal with local GGUF (`embeddinggemma-2`).
- 🔍 **Lexical Precision & Wildcards**: Full support for wildcard globbing (`Grid*`, `*Style`, `Navigation*View`), exact-title boosting, and kind aliasing (`func` ↔ `method`).
- 📖 **DocC AST to Agent Markdown**: Formats Apple DocC JSON into concise Markdown with method signatures, parameter tables, deprecation notices, and live CDN fallback.
- 🩺 **Instant Diagnostics**: Built-in `npm run doctor` command verifies database integrity, vector dimension consistency, and framework attribution in seconds.

---

## The Power of Semantic Search

Traditional documentation tools require you to know the exact symbol name in advance. But when developers and AI agents build apps, they search for **behaviors, lifecycle events, and UI concepts**:

| What You Ask / What Agent Searches          | How Keyword Search Fails             | What `semantic_search` Returns                                  |
| :------------------------------------------ | :----------------------------------- | :-------------------------------------------------------------- |
| _"prevent sheet swipe dismiss"_             | 0 matches (words don't match)        | `interactiveDismissDisabled(_:)`                                |
| _"code that runs when screen appears"_      | Matches random functions named `run` | `onAppear(perform:)`, `viewIsAppearing()`, `viewDidLoad()`      |
| _"react useEffect equivalent"_              | 0 matches                            | `.task(id:_:)`, `.onChange(of:_:)`                              |
| _"three column navigation layout"_          | Matches generic `Navigation` terms   | `NavigationSplitView`, `NavigationSplitViewVisibility`          |
| _"store sensitive credentials in keychain"_ | Misses non-keyword matches           | `SecItemAdd`, `kSecClassGenericPassword`, `LocalAuthentication` |

### How the Hybrid Engine Works

```text
User / Agent Query ("prevent user from swiping sheet down")
  │
  ├──► Lexical Branch: SQLite FTS5 (BM25 + Exact Name Boost)
  │
  └──► Semantic Branch: Dense Vector Embedding (Gemini or Local GGUF)
         └─ Cosine similarity against 19,000+ enriched Apple DocC vectors
  │
  ▼
Reciprocal Rank Fusion (RRF, k=60)
  │
  ▼
Ranked, Deduplicated Results with Runnable get_documentation Links
```

- **Zero Demotion Risk**: Exact symbol matches receive an explicit boost so lexical precision is never sacrificed for semantic breadth.
- **Enriched Member Abstracts**: Includes 13,800+ backfilled view modifiers, initializers, and methods so modifiers like `.interactiveDismissDisabled()` are indexed by behavior.
- **Calibrated Similarity Thresholds**: Uses empirically tuned cosine floors (`0.65` for Gemini, `0.68` for Gemma) to filter background noise while surfacing relevant API families.

---

## Quick Install

### 1. Claude Desktop / Claude Code / Cursor / Windsurf

Add the server to your MCP configuration (`claude_desktop_config.json`, `.cursor/mcp.json`, etc.):

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

_(Tip: `GEMINI_API_KEY` enables hybrid semantic search. If omitted, the server operates in offline lexical mode)._

### 2. Antigravity Plugin

```bash
# Direct install
agy plugin install AndrewMason7/apple-doc-plugin
# Or from local clone
agy plugin install .
```

### 3. Hermes Agent Plugin (Native)

```bash
hermes plugins install https://github.com/AndrewMason7/apple-doc-plugin.git
hermes plugins enable apple-doc-plugin
```

---

## Getting Started (Clone & Build)

**Prerequisites:** Node.js ≥ 22 (`node -v`).

```bash
# 1. Clone & install dependencies
git clone https://github.com/AndrewMason7/apple-doc-plugin.git
cd apple-doc-plugin
npm install
npm run build

# 2. Run diagnostics
npm run doctor
```

`npm run doctor` inspects your database, schema, and embedding setup:

```text
✔ Node.js                v24.x
✔ Index file             data/apple-docs.db (30.3 MB)
✔ Symbols                65,787 rows
✔ FTS index              65,787 rows
✔ Symbol kinds           every row classified
✔ Framework attribution  consistent with paths
✔ Embedding provider     local-gguf (768-d) (or gemini)
⚠ Semantic layer         0/100 vectors — hybrid search cannot engage; queries stay lexical
   → npm run embed-index
✔ Vector dimensions      no vectors stored
✔ Snapshot age           0 days old (from index timestamp)

All checks passed (1 warning).
```

> **Note:** The shipped snapshot is immediately usable for fast offline lexical search (65,787 symbols). Once you configure a provider and run `npm run embed-index`, the semantic layer flips to `✔` with 19,473 vectors stored and hybrid search engages.

---

## Setting Up Semantic Search

The repository ships with lexical FTS5 ready out-of-the-box. Enabling the semantic layer gives you full hybrid vector search. You can choose hosted Gemini or 100% offline local GGUF:

### Option A: Hosted Gemini (Recommended & Fastest)

Gemini embeddings (`gemini-embedding-2`) provide the highest conceptual ranking and fastest generation rate (~50 embeddings/second via batching).

1. Get an API key from [Google AI Studio](https://aistudio.google.com/) (free tier available).
2. Configure your environment:
   ```bash
   cp .env.example .env
   echo "GEMINI_API_KEY=your-api-key" >> .env
   ```
3. Generate the vector embeddings:
   ```bash
   # Generates ~19,400 symbol embeddings with member abstracts in ~5 minutes
   npm run embed-index
   ```
4. Verify status:
   ```bash
   npm run doctor
   ```
   The semantic layer will now display `✔` and hybrid search is immediately engaged.

### Option B: Local GGUF (100% Offline & Private)

Run vector embeddings completely on-device using EmbeddingGemma via Apple Silicon Metal acceleration:

```bash
# 1. Download model into local cache (~309 MB)
mkdir -p ~/.cache/apple-docs/models
hf download unsloth/embeddinggemma-2-GGUF embeddinggemma-2-Q8_0.gguf --local-dir ~/.cache/apple-docs/models

# 2. Embed the symbol layer
npm run embed-index
```

---

## MCP Tools Reference

The server exposes dedicated tools designed specifically for AI agent pair programming:

| Tool                         | Purpose                       | When to Use                                                                                                                  | Example Query                                                                             |
| :--------------------------- | :---------------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `semantic_search` ⭐         | **Hybrid Semantic Search**    | **Default tool for agents.** Use when you know what you want to achieve, describe UI concepts, or ask behavioral questions.  | `semantic_search({ "query": "dismiss keyboard on tap outside", "framework": "SwiftUI" })` |
| `search_symbols`             | **Fast Lexical Search**       | Use when searching for specific names, prefix/suffix wildcards (`Grid*`, `*Style`), or filtering by kind (`func`, `struct`). | `search_symbols({ "query": "Navigation*View", "framework": "SwiftUI" })`                  |
| `get_documentation`          | **Full Documentation Lookup** | Use to inspect parameters, return types, code declarations, and discussion for a specific symbol or DocC path.               | `get_documentation({ "path": "NavigationStack" })`                                        |
| `discover_technologies`      | **Framework Discovery**       | Use to discover available Apple frameworks in the database and see symbol counts.                                            | `discover_technologies()`                                                                 |
| `index_info` / `get_version` | **Index & Health Status**     | Inspect server version, search mode (`Lexical only` vs `Hybrid`), freshness, and database statistics.                        | `index_info()`                                                                            |

### Search Modes Compared

| Capability            | Offline Lexical (Default)        | Hybrid Semantic (Embedded)                       |
| :-------------------- | :------------------------------- | :----------------------------------------------- |
| **Primary Tool**      | `search_symbols`                 | `semantic_search`                                |
| **Ranking Algorithm** | SQLite FTS5 (BM25)               | Reciprocal Rank Fusion (BM25 + Cosine Vectors)   |
| **Query Type**        | Exact names, wildcards (`Grid*`) | Natural language, concepts, behaviors            |
| **Requirements**      | Node.js 22+ (shipped database)   | Gemini Key or local GGUF (`npm run embed-index`) |
| **Network Access**    | 100% Offline                     | 100% Offline (with GGUF) or Gemini API           |

---

## Configuration

Settings can be specified in `.env` or passed via your MCP server environment config:

| Variable                          | Default              | Description                                                                                                   |
| :-------------------------------- | :------------------- | :------------------------------------------------------------------------------------------------------------ |
| `GEMINI_API_KEY`                  | _none_               | Gemini API key for hosted semantic search and embeddings.                                                     |
| `APPLE_DOCS_EMBEDDING_PROVIDER`   | `auto`               | Force provider: `gemini` or `local` (GGUF). Defaults to `local` if model file exists, else `gemini`.          |
| `APPLE_DOCS_EMBEDDING_MODEL_PATH` | `~/.cache/...`       | Path to local `embeddinggemma-2-Q8_0.gguf` file.                                                              |
| `APPLE_DOCS_EMBEDDING_DIMENSIONS` | `768`                | MRL vector dimensions (`128`, `256`, `512`, `768`, `1024`, `1536`, `2048`, `3072`). Default `768` is optimal. |
| `APPLE_DOCS_DB_PATH`              | `data/apple-docs.db` | Custom path to the SQLite documentation database.                                                             |

---

## CLI & Database Commands

| Command                | Description                                                                                    |
| :--------------------- | :--------------------------------------------------------------------------------------------- |
| `npm run doctor`       | Run 10-point health check (`--json` and `--strict` supported for CI).                          |
| `npm run embed-index`  | Generate or resume vector embeddings for hybrid search (`--enrich`, `--limit 25`, `--all`).    |
| `npm run repair-index` | Fix framework attribution and symbol kinds in place without re-crawling (`--apply` to commit). |
| `npm run build:index`  | Crawl and rebuild the entire local database from Apple's DocC CDN.                             |
| `npm test`             | Run complete test suite (193 tests).                                                           |
| `npm run check`        | Run TypeScript typechecking and Prettier verification.                                         |

---

## Troubleshooting

- **Check health first**: Run `npm run doctor` — every warning or failure includes a recommended fix command.
- **Native addon compilation**: If `npm install` fails compiling `better-sqlite3`, install native build tools (`xcode-select --install` on macOS, or `build-essential` on Linux).
- **Full Troubleshooting Guide**: See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for in-depth solutions for every diagnostic check.

---

## Prior Art

The MCP tool contract follows conventions established by [MightyDillah/apple-doc-mcp](https://github.com/MightyDillah/apple-doc-mcp). While that project routes live queries to Apple's CDN on-the-fly, this project provides a high-speed local SQLite FTS5 database, Reciprocal Rank Fusion hybrid semantic search, DocC Markdown rendering, and integrated agent development rules.

---

## License

[MIT](LICENSE) © 2026 Andrew Mason
