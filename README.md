# Apple Developer Documentation MCP Server & Plugin

[![npm version](https://img.shields.io/npm/v/apple-doc-plugin.svg)](https://www.npmjs.com/package/apple-doc-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-1.27.1-purple.svg)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)

**High-performance MCP server and Antigravity/Hermes plugin featuring Hybrid Semantic Search and offline Apple Developer Documentation.**

Gives coding agents (Claude Code, Cursor, Windsurf, Antigravity, Hermes) deep understanding of Apple frameworks — allowing agents to search by **natural-language behavior, concepts, and intent**, not just exact symbol names.

---

### Highlights

- 🧠 **Hybrid Semantic Search**: Combines dense vector embeddings with SQLite FTS5 BM25 via **Reciprocal Rank Fusion (RRF)**. Finds the right APIs even when your query shares zero words with the symbol name.
- 🌉 **Cross-Framework Query Expansion**: Seamlessly bridges Web, React, and Android idioms (`useEffect`, `SharedPreferences`, `Flexbox`, `coroutine`, `AsyncStorage`) into native Apple symbols (`task`, `onAppear`, `AppStorage`, `HStack`, `VStack`, `Spacer`).
- 🛠️ **One-Click IDE Configuration CLI**: Safely configure Cursor, Claude Desktop, Windsurf, Antigravity, and VS Code with `apple-doc-plugin install --target <ide>`.
- ⚡ **95,899 Symbols Offline**: Ships with a pre-indexed database covering 25 Apple frameworks (SwiftUI, UIKit, Foundation, Security, AVFoundation, WebKit, RealityKit, Vision, StoreKit, MapKit, CoreData, SwiftData, Combine, AppKit, Swift, Observation, CoreLocation, AuthenticationServices, LocalAuthentication, RegexBuilder, Synchronization, Distributed, and more) across both Swift and Objective-C/C symbol trees.
- 🎯 **Dual Semantic Engines**: Run hosted embeddings with **Google Gemini** (`gemini-embedding-2`) or **100% offline** on Apple Silicon Metal with local GGUF (`embeddinggemma-2`).
- 🔍 **Lexical Precision & Wildcards**: Full support for wildcard globbing (`Grid*`, `*Style`, `Navigation*View`), exact-title boosting, and kind aliasing (`func` ↔ `method`).
- 📖 **DocC AST to Agent Markdown**: Formats Apple DocC JSON into concise Markdown with method signatures, parameter tables, deprecation notices, and live CDN fallback.
- 🩺 **Instant Diagnostics & Setup**: Built-in `apple-doc-plugin setup` and `apple-doc-plugin doctor` commands verify database integrity, vector dimensions, and embedding providers in seconds.

---

## The Power of Semantic Search & Cross-Framework Recall

Traditional documentation tools require you to know the exact symbol name in advance. But when developers and AI agents build apps, they search for **behaviors, lifecycle events, and cross-platform idioms**:

> The right-hand column below was produced by the **hybrid** engine with `gemini-embedding-2`. In lexical-only mode (no vectors configured) the same queries fall back to keyword matching and return much weaker results — run `npm run download-vectors` or `npm run embed-index` to enable hybrid search. The local `embeddinggemma-2` model has a measurably lower ceiling on behavioral queries; see [Provider quality](#provider-quality).

| What You Ask / What Agent Searches     | How Keyword Search Fails             | What `semantic_search` Returns (hybrid, Gemini)          |
| :------------------------------------- | :----------------------------------- | :------------------------------------------------------- |
| _"prevent sheet swipe dismiss"_        | 0 matches (words don't match)        | `interactiveDismissDisabled(_:)` ✅                      |
| _"code that runs when screen appears"_ | Matches random functions named `run` | `viewIsAppearing()`, `viewDidAppear(_:)`                 |
| _"react useEffect equivalent"_         | 0 matches (React terminology)        | `.task(id:_:)`, `onAppear(perform:)`, `.onChange(of:_:)` |
| _"android shared preferences storage"_ | 0 matches (Android terminology)      | `@AppStorage`, `UserDefaults`                            |
| _"display: flex layout"_               | 0 matches (CSS Flexbox terminology)  | `HStack`, `VStack`, `Spacer`, `Layout`                   |
| _"three column navigation layout"_     | Matches generic `Navigation` terms   | `NavigationSplitView`, `case tripleColumn`               |
| _"dismiss keyboard on tap outside"_    | 0 matches (the symbol is not named)  | `dismissKeyboard()`, `scrollDismissesKeyboardMode`       |

> **Comprehensive Framework Coverage:** The offline database includes complete coverage for Security (Keychain Services with `SecItemAdd`), WebKit (`WKWebView`), AVFoundation (`AVPlayer`), StoreKit (`SKPaymentQueue`), MapKit (`MKMapView`), CoreData (`NSManagedObject`), RealityKit (`Entity`), Vision (`VNRecognizeTextRequest`), AuthenticationServices (`ASAuthorizationAppleIDProvider`), and LocalAuthentication (`LAContext`). See [Coverage](#coverage) for detailed framework breakdowns.

### How the Hybrid Engine Works

```text
User / Agent Query ("react useEffect equivalent" or "prevent sheet swipe down")
  │
  ├──► Query Expansion Layer: Maps 18+ Web/React/Android idioms into native Apple symbols
  │
  ├──► Lexical Branch: SQLite FTS5 (BM25 + Exact Name Boost + Mapped Symbol Bonus)
  │
  └──► Semantic Branch: Dense Vector Embedding (Gemini or Local GGUF)
         └─ Enriched context prompt against 19,473 Apple DocC vectors
  │
  ▼
Reciprocal Rank Fusion (RRF, k=60)
  │
  ▼
Ranked, Deduplicated Results with Runnable get_documentation Links
```

- **Zero Demotion Risk**: Exact symbol matches receive an explicit boost so lexical precision is never sacrificed for semantic breadth.
- **Enriched Member Abstracts**: Includes backfilled view modifiers, initializers, and methods so modifiers like `.interactiveDismissDisabled()` are indexed by behavior.
- **Calibrated Similarity Thresholds**: Uses empirically tuned cosine floors (`0.65` for Gemini, `0.68` for Gemma) to filter background noise while surfacing relevant API families.
- **Real fusion, no duplicates**: Symbol vectors are stored under `sym-<symbolId>`; the fusion layer maps that back to the symbol id so a document found by both retrievers is emitted once with `source: "hybrid"` instead of appearing twice.

---

## Quick Install & Setup (Zero Clone Required)

Run directly via `npx` without cloning or building from source:

### 1. One-Click IDE / Agent Configuration (Recommended)

Automatically detect and configure your coding assistant's MCP configuration with portable `npx` execution:

```bash
# Target Cursor
npx apple-doc-plugin install --target cursor

# Target Claude Desktop
npx apple-doc-plugin install --target claude-desktop

# Target Windsurf
npx apple-doc-plugin install --target windsurf

# Target Antigravity
npx apple-doc-plugin install --target antigravity

# Target VS Code
npx apple-doc-plugin install --target vscode
```

_(Pass `--dry-run` to preview changes without modifying disk, `--local` to link a local repository clone, or `--env GEMINI_API_KEY=...` to attach API credentials)._

### 2. First-Run Setup & Vector Bootstrap

Verify your installation, inspect database integrity, and optionally bootstrap offline vector assets:

```bash
# Verify health and search mode
npx apple-doc-plugin setup

# Automatically download pre-computed 768-d vectors and configure Cursor
npx apple-doc-plugin setup --download-vectors --target cursor
```

### 3. Manual MCP Configuration (Optional)

If preferred, drop this directly into your MCP configuration (`claude_desktop_config.json`, `.cursor/mcp.json`, etc.):

```json
{
	"mcpServers": {
		"apple-docs": {
			"command": "npx",
			"args": ["-y", "apple-doc-plugin"],
			"env": {
				"GEMINI_API_KEY": "YOUR_GEMINI_API_KEY"
			}
		}
	}
}
```

_(Tip: `GEMINI_API_KEY` enables hybrid semantic search. If omitted, the server operates in offline lexical mode, or uses local `embeddinggemma-2` if downloaded via `npx apple-doc-plugin download-model`)._

### 4. Global CLI Installation

```bash
npm install -g apple-doc-plugin
apple-doc-plugin --help
```

### 5. Antigravity Plugin

```bash
# Direct install
agy plugin install AndrewMason7/apple-doc-plugin
# Or from local clone
agy plugin install .
```

### 6. Hermes Agent Plugin (Native)

```bash
hermes plugins install https://github.com/AndrewMason7/apple-doc-plugin.git
hermes plugins enable apple-doc-plugin
```

---

## Building From Source (Contributors)

If you are developing or contributing to `apple-doc-plugin`:

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
✔ Node.js                v24.x (or v26.x)
✔ Index file             data/apple-docs.db (48.1 MB)
✔ Symbols                95,899 rows
✔ FTS index              95,899 rows
✔ Symbol kinds           every row classified
✔ Framework attribution  consistent with paths
✔ Embedding provider     local-gguf (768-d) (or gemini)
⚠ Semantic layer         0/100 vectors — hybrid search cannot engage; queries stay lexical
   → npm run download-vectors   (fast, bundled artifact)
   → npm run embed-index       (build locally)
✔ Vector dimensions      no vectors stored
✔ Snapshot age           0 days old (from build metadata)

All checks passed (1 warning).
```

> **Note:** The shipped snapshot is immediately usable for fast offline lexical search (95,899 symbols). Run `npm run download-vectors` to import the bundled 768-d vector artifact (19,473 vectors) in seconds, or `npm run embed-index` to build them yourself. Either way the semantic layer flips to `✔` and hybrid search engages.

---

## Setting Up Semantic Search

The repository ships with lexical FTS5 ready out-of-the-box. Enabling the semantic layer gives you full hybrid vector search.

### Option A: Pre-computed Vector Artifact (Fastest — No API Key)

The 768-d vector layer is bundled in the repository as a gzip-compressed SQLite artifact (~54 MB) and pinned by SHA-256. Importing it takes seconds and needs no embedding provider:

```bash
npm run download-vectors
npm run doctor
```

The command prefers the artifact already present under `assets/` (repo clone / plugin install), so this works fully offline. It falls back to the mirrored URL only when the bundled file is missing, and verifies the checksum on every path.

> The full hybrid database is ~113 MB, over GitHub's 100 MB file limit, which is why the corpus and the vectors ship as two files instead of one.

### Option B: Hosted Gemini (Best Ranking)

Gemini embeddings (`gemini-embedding-2`) provide the highest conceptual ranking and fastest generation rate (~50 embeddings/second via batching). This is the provider the behavioral examples in this README were verified against.

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

### Option C: Local GGUF (100% Offline & Private)

Run vector embeddings completely on-device using EmbeddingGemma via Apple Silicon Metal acceleration:

```bash
# 1. Download model into local cache (~309 MB)
mkdir -p ~/.cache/apple-docs/models
hf download unsloth/embeddinggemma-2-GGUF embeddinggemma-2-Q8_0.gguf --local-dir ~/.cache/apple-docs/models

# 2. Embed the symbol layer
npm run embed-index
```

### Provider quality

The two embedding backends are not equivalent on behavioral queries. Measured on the shipped corpus (top result for each query):

| Query                                  | `gemini-embedding-2`                | `embeddinggemma-2` (Q8_0, local)          |
| :------------------------------------- | :---------------------------------- | :---------------------------------------- |
| _"prevent sheet swipe dismiss"_        | `interactiveDismissDisabled(_:)` ✅ | `swipeActionsContainer()` ❌              |
| _"code that runs when screen appears"_ | `viewIsAppearing()` ✅              | `Protecting sensitive content…` ❌        |
| _"three column navigation layout"_     | `NavigationSplitView` ✅            | `NavigationSplitView` ✅                  |
| _"dismiss keyboard on tap outside"_    | `dismissKeyboard()` ✅              | `Handling key presses…` ❌                |
| _"biometric authentication view"_      | `LocalAuthenticationView` ✅        | `Handling an authentication challenge` ❌ |
| `_NavigationSplitView_` (exact)        | `NavigationSplitView` ✅            | `NavigationSplitView` ✅                  |

The 270M local backbone has a real ceiling over terse one-line abstracts: it is fine for exact names and concept-level matches, and misses many intent-style paraphrases. Use Gemini when ranking quality matters, and the local model when privacy/offline matters more.

---

## MCP Tools Reference

The server exposes dedicated tools designed specifically for AI agent pair programming:

| Tool                         | Purpose                       | When to Use                                                                                                                                                                             | Example Query                                                                             |
| :--------------------------- | :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `semantic_search` ⭐         | **Hybrid Semantic Search**    | **Default tool for agents.** Use when you know what you want to achieve, describe UI concepts, or ask behavioral questions.                                                             | `semantic_search({ "query": "dismiss keyboard on tap outside", "framework": "SwiftUI" })` |
| `search_symbols`             | **Fast Lexical Search**       | Use when searching for specific names, prefix/suffix wildcards (`Grid*`, `*Style`), or filtering by kind (`func`, `struct`).                                                            | `search_symbols({ "query": "Navigation*View", "framework": "SwiftUI" })`                  |
| `get_documentation`          | **Full Documentation Lookup** | Use to inspect parameters, return types, code declarations, and discussion. Supports `concise: true` to strip verbose narratives and save context tokens. Includes fuzzy typo recovery. | `get_documentation({ "path": "NavigationStack", "concise": true })`                       |
| `discover_technologies`      | **Framework Discovery**       | Use to discover available Apple frameworks in the database and see symbol counts.                                                                                                       | `discover_technologies()`                                                                 |
| `index_info` / `get_version` | **Index & Health Status**     | Inspect server version, search mode (`Lexical only` vs `Hybrid`), freshness, and database statistics.                                                                                   | `index_info()`                                                                            |

### Search Modes Compared

| Capability            | Offline Lexical (Default)        | Hybrid Semantic (Embedded)                                                                      |
| :-------------------- | :------------------------------- | :---------------------------------------------------------------------------------------------- |
| **Primary Tool**      | `search_symbols`                 | `semantic_search`                                                                               |
| **Ranking Algorithm** | SQLite FTS5 (BM25)               | Reciprocal Rank Fusion (BM25 + Cosine Vectors)                                                  |
| **Query Type**        | Exact names, wildcards (`Grid*`) | Natural language, concepts, behaviors                                                           |
| **Requirements**      | Node.js 22+ (shipped database)   | Vector artifact, Gemini Key, or local GGUF (`npm run download-vectors` / `npm run embed-index`) |
| **Network Access**    | 100% Offline                     | 100% Offline (bundled artifact or GGUF) or Gemini API                                           |

---

## Coverage

The snapshot holds **95,899 symbols** across 25 indexed frameworks (with at least 25 symbols each), covering both Swift and Objective-C/C symbol trees:

| Indexed framework      | Symbols |     | Indexed framework   | Symbols |
| :--------------------- | ------: | :-- | :------------------ | ------: |
| Swift                  |  18,442 |     | CoreData            |   1,170 |
| Foundation             |  13,013 |     | Combine             |   1,062 |
| AppKit                 |  12,654 |     | SwiftData           |     552 |
| UIKit                  |  11,449 |     | CoreLocation        |     474 |
| Security               |   7,331 |     | RegexBuilder        |     462 |
| SwiftUI                |   7,202 |     | LocalAuthentication |     246 |
| RealityKit             |   6,235 |     | Synchronization     |     196 |
| AVFoundation           |   5,614 |     | Distributed         |      93 |
| WebKit                 |   3,193 |     | BundleResources     |      88 |
| Vision                 |   1,915 |     | ObjectiveC          |      77 |
| StoreKit               |   1,531 |     | AVFAudio            |      45 |
| AuthenticationServices |   1,473 |     | Observation         |      37 |
| MapKit                 |   1,299 |     |                     |         |

Cross-reference targets (pages linked from indexed frameworks): visionOS (22), Xcode (11), PassKit (6), WidgetKit (4), AVKit (3).

**What this means in practice:**

- **First-Class Platform Coverage**: Core platform frameworks including Security (Keychain Services), WebKit, AVFoundation, StoreKit, MapKit, CoreData, RealityKit, Vision, AuthenticationServices, and LocalAuthentication are fully indexed offline.
- **Full C Function and Swift Method Resolution**: Both bare C function names (e.g., `SecItemAdd`) and standard Swift types/methods (`WKWebView`, `MKMapView`, `SKPaymentQueue`, `AVPlayer`, `NSManagedObject`, `LAContext`) resolve cleanly via `search_symbols` and `get_documentation`.
- **Hybrid Semantic Search**: Semantic vectors are available for 19,473 core framework symbols via `npm run download-vectors` (or local embedding via `npm run embed-index`). All 95,899 symbols across all 25 indexed frameworks remain fully discoverable by name, kind, and signature via lexical search and point documentation lookup.

---

### MCP Resources & Prompts

In addition to tools, `apple-doc-plugin` implements native MCP Resources and Prompts:

- **Resources**:
  - `apple-docs://frameworks`: Returns JSON metadata and exact primary symbol counts for all 25 indexed frameworks (see [Coverage](#coverage)).
  - `apple-docs://symbols/{framework}`: Returns a clean catalog of primary types, protocols, and macros for any indexed framework (e.g. `apple-docs://symbols/SwiftUI`).
- **Prompts**:
  - `modernize-navigation`: Automated migration template from legacy `NavigationView` to `NavigationStack` / `NavigationSplitView`.
  - `scaffold-swiftdata`: Scaffold `@Model` schemas, container configuration, and SwiftUI `@Query` view bindings.
  - `audit-deprecation`: Audit Swift/SwiftUI code against modern deployment targets and flags deprecated APIs.

---

## Configuration

Settings can be specified in `.env` or passed via your MCP server environment config:

| Variable                          | Default                      | Description                                                                                                                        |
| :-------------------------------- | :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                  | _none_                       | Gemini API key for hosted semantic search and embeddings.                                                                          |
| `APPLE_DOCS_EMBEDDING_PROVIDER`   | `auto`                       | Force provider: `gemini` or `local` (GGUF). Defaults to `local` if model file exists, else `gemini`.                               |
| `APPLE_DOCS_EMBEDDING_MODEL_PATH` | `~/.cache/...`               | Path to local `embeddinggemma-2-Q8_0.gguf` file.                                                                                   |
| `APPLE_DOCS_EMBEDDING_DIMENSIONS` | `768`                        | MRL vector dimensions (`128`, `256`, `512`, `768`, `1024`, `1536`, `2048`, `3072`). Default `768` is optimal.                      |
| `APPLE_DOCS_DB_PATH`              | `data/apple-docs.db`         | Custom path to the SQLite documentation database.                                                                                  |
| `APPLE_DOCS_VECTORS_URL`          | _bundled asset, then mirror_ | Override the vector artifact URL. The artifact already under `assets/` is preferred, so clones and plugin installs import offline. |

---

## CLI & Database Commands

The executable CLI supports standalone commands and subcommands:

| Command                                                             | Description                                                                                                |
| :------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------- |
| `npm run doctor` (or `apple-doc-plugin doctor`)                     | Run 10-point health check (`--json` and `--strict` supported for CI).                                      |
| `npm run download-vectors` (or `apple-doc-plugin download-vectors`) | Import the bundled (or mirrored) gzip 768-d vector artifact with SHA-256 verification and mirror failover. |
| `npm run export-vectors` (or `apple-doc-plugin export-vectors`)     | Export semantic vector bundle into verifiable standalone SQLite package with companion manifest and hash.  |
| `npm run index-xcode` (or `apple-doc-plugin index-xcode`)           | Directly ingest and index offline `.doccarchive` documentation from local Xcode SDKs and DerivedData.      |
| `npm run download-model` (or `apple-doc-plugin download-model`)     | Automated download of local GGUF (`embeddinggemma-2-Q8_0.gguf`) into local cache without HuggingFace CLI.  |
| `npm run embed-index`                                               | Generate or resume vector embeddings for hybrid search (`--enrich`, `--limit 25`, `--all`).                |
| `npm run repair-index`                                              | Fix framework attribution and symbol kinds in place without re-crawling (`--apply` to commit).             |
| `npm run build:binary` (or `scripts/build-binary.sh`)               | Build standalone native runner and release distribution archive.                                           |
| `npm test`                                                          | Run complete test suite (372 tests).                                                                       |
| `npm run check`                                                     | Run TypeScript typechecking and Prettier verification.                                                     |

---

## Standalone Distribution & Homebrew

### Homebrew (macOS)

Install via Homebrew using the official formula:

```bash
brew install packaging/homebrew/apple-doc-plugin.rb
```

### Standalone Binary Packaging

Build a self-contained executable runner and release tarball:

```bash
./scripts/build-binary.sh --tarball
```

Produces `bin/apple-doc-plugin-native` and `dist/apple-doc-plugin-<version>-<platform>.tar.gz`.

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
