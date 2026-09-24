# Apple Developer Documentation MCP Server & Plugin

[![Tests](https://img.shields.io/badge/tests-72%20passed-brightgreen.svg)](#-testing--quality)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-1.27.1-purple.svg)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)

A high-performance Model Context Protocol (MCP) server and Antigravity plugin providing instant, offline-first access to Apple Developer Documentation. Features embedded SQLite FTS5 symbol search, wildcard matching, a rich DocC AST-to-Markdown parser, and optional multimodal Gemini semantic embeddings.

---

## ✨ Features

- **🚀 Sub-Millisecond Symbol Search**: Pre-indexed SQLite database (`apple-docs.db`) with FTS5 BM25 scoring over 100,000+ symbols across core Apple frameworks (SwiftUI, UIKit, Foundation, SwiftData, Combine, AppKit, Observation, CoreLocation).
- **🌐 Global Search by Default**: AI agents can search symbols immediately without being forced to run `choose_technology` first.
- **🎯 Scoped Search When Desired**: Search globally or narrow results by passing `framework: "SwiftUI"` or choosing an active technology.
- **📄 Rich DocC AST-to-Markdown Formatter**: Formats official Apple documentation into clean, context-optimized Markdown complete with:
  - Syntax-highlighted Swift declarations (` ```swift ... ``` `)
  - GitHub-style deprecation alerts (`> [!WARNING]`) with modern replacements
  - Formatted parameter documentation (`### Parameters`)
  - Official Apple discussion notes and code examples
- **🖼️ Multimodal UI Layout Previews**: Leverages `gemini-embedding-2` to embed Apple's diagrams, layout previews, and HIG screenshots. Agents can query visual concepts and receive rendered `![Visual Preview](...)` markdown inline.
- **🧠 Hybrid Semantic Search (Optional)**: When `GEMINI_API_KEY` or Google Application Default Credentials (ADC) are provided, combines lexical BM25 ranking and 3072-dimensional vector similarities via Reciprocal Rank Fusion (RRF).
- **🛡️ Resilience & Circuit Breaker**: Header-based authentication (`x-goog-api-key`), credential sanitization, and an automatic 30s circuit breaker on API errors/rate-limits with zero-config offline SQLite fallback.

---

## 🛠️ Available MCP Tools

| Tool                    | Parameters                                                                                                                                                                 | Description                                                                                                                                                                                                                                                  |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_symbols`        | `query` (string, required)<br>`framework` (string, optional)<br>`platform` (string, optional)<br>`symbolType` (string, optional)<br>`maxResults` (number, optional, 1–100) | **Symbol Lookup Tool**. Instant search across symbols with exact-name boosting and wildcard matching (`*`, `?`).                                                                                                                                             |
| `semantic_search`       | `query` (string, required)<br>`framework` (string, optional)<br>`platform` (string, optional)<br>`symbolType` (string, optional)<br>`maxResults` (number, optional, 1–100) | **Conceptual & Intent Tool**. Natural language search powered by Gemini hybrid vector embeddings. Use when describing behaviors, UI concepts, or when the exact symbol name is unknown.                                                                      |
| `get_documentation`     | `path` (string, required)<br>`framework` (string, optional)                                                                                                                | Fetches rich documentation for a symbol or path (e.g., `NavigationStack` or `documentation/swiftui/view`), with Swift declarations, parameters, deprecation warnings, and discussion examples. Disambiguates symbols via the optional `framework` parameter. |
| `discover_technologies` | `query` (string, optional)<br>`limit` (number, optional)                                                                                                                   | Browse and filter available Apple technologies and frameworks.                                                                                                                                                                                               |
| `choose_technology`     | `name` (string, required)                                                                                                                                                  | Optionally scope subsequent searches and lookups to a specific framework (backward compatible).                                                                                                                                                              |
| `current_technology`    | _none_                                                                                                                                                                     | View the currently selected technology scope.                                                                                                                                                                                                                |
| `get_version`           | _none_                                                                                                                                                                     | Report MCP server version.                                                                                                                                                                                                                                   |

---

## 📦 Installation & Setup

### Antigravity Plugin (Recommended)

Install directly with the `agy` CLI:

```bash
# Install from local directory:
agy plugin install .

# Or install from GitHub:
agy plugin install AndrewMason7/apple-doc-plugin
```

Once installed, the plugin automatically provides:

- **`apple-docs` MCP Server**: Registered and active for all sessions via `bin/launcher.cjs`.
- **`apple-docs` Skill**: Workflow guidance for discovering, searching, and inspecting Apple APIs.
- **Apple Platform Rules**: Enforces API verification and modern framework patterns (e.g. `NavigationStack` over `NavigationView`, `@Observable` over `ObservableObject`, SwiftData over Core Data).

To validate the plugin structure:

```bash
agy plugin validate .
```

### Manual MCP Server Configuration (Claude Code / Cursor / Windsurf)

Add to your MCP configuration (`mcpServers`):

```json
{
	"mcpServers": {
		"apple-docs": {
			"command": "node",
			"args": ["/path/to/apple-doc-plugin/dist/index.js"],
			"env": {
				"GEMINI_API_KEY": "YOUR_GEMINI_API_KEY"
			}
		}
	}
}
```

_(Note: `GEMINI_API_KEY` and ADC are optional. If omitted, pure local SQLite FTS5 runs 100% offline.)_

---

## ⚙️ Environment Configuration

Copy the template to create your local `.env`:

```bash
cp .env.example .env
```

| Variable                         | Required | Description                                                                                                                                                          |
| :------------------------------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                 | Optional | Google Gemini API key for multimodal 3072-dim embeddings (`gemini-embedding-2`). Get one at [Google AI Studio](https://aistudio.google.com/).                        |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional | Path to Service Account JSON key for Google Application Default Credentials (ADC). Alternatively, `gcloud auth application-default login` is detected automatically. |
| `APPLE_DOCS_DB_PATH`             | Optional | Custom path to the SQLite index database (defaults to `data/apple-docs.db`).                                                                                         |

The server automatically loads `.env` natively at startup.

---

## 🔍 Usage Examples for AI Agents

- **Exact Symbol Lookup**:
  ```json
  search_symbols({ "query": "NavigationSplitView" })
  ```
- **Scoped Framework Search**:
  ```json
  search_symbols({ "query": "ViewController", "framework": "UIKit" })
  ```
- **Wildcard Prefix & Suffix Search**:
  ```json
  search_symbols({ "query": "Grid*" })
  search_symbols({ "query": "*Style" })
  ```
- **Platform & Type Filtered Search**:
  ```json
  search_symbols({ "query": "View", "platform": "iOS", "symbolType": "protocol" })
  ```
- **Direct Documentation Retrieval**:
  ```json
  get_documentation({ "path": "NavigationStack", "framework": "SwiftUI" })
  ```
- **Conceptual Intent / Behavioral Search (Gemini Semantic)**:
  ```json
  semantic_search({ "query": "prevent user from dragging sheet down to close", "framework": "SwiftUI" })
  semantic_search({ "query": "persist user login credentials securely across reboots" })
  ```
- **Multimodal Layout Diagram Queries**:
  ```json
  semantic_search({ "query": "three column sidebar split view diagram", "framework": "SwiftUI" })
  ```

---

## 🏗️ Repository Architecture

Strictly adhering to Separation of Concerns (SoC):

```
apple-doc-plugin/
├── bin/
│   └── launcher.cjs             # Auto-bootstrapping plugin runner for Antigravity
├── data/
│   └── apple-docs.db            # Pre-indexed SQLite database (FTS5 + vectors)
├── rules/
│   └── AGENTS.md                # Apple platform guidelines & API rules
├── skills/
│   └── apple-docs/              # Antigravity skill definition & reference guides
├── src/
│   ├── index.ts                 # CLI stdio MCP server entrypoint
│   ├── apple-client.ts          # Apple Developer Documentation HTTP client & file cache
│   ├── apple-client/
│   │   ├── docc-formatter.ts    # Pure DocC AST-to-Markdown formatter
│   │   ├── http-client.ts       # Resilient HTTP transport with memory caching
│   │   └── types/               # DocC AST data contracts and schema types
│   └── server/
│       ├── app.ts               # MCP Server setup & resource registry
│       ├── context.ts           # Shared ServerContext
│       ├── db/                  # SQLite FTS5 database abstraction layer
│       ├── handlers/            # Dedicated MCP tool handlers (one per tool)
│       └── services/            # Hybrid search, semantic search, and symbol resolution
└── test/                        # Comprehensive unit, integration, and stress tests
```

---

## 🧪 Testing & Quality

```bash
# Compile TypeScript
npm run build

# Run complete test suite (unit, integration, ADC, stress, e2e)
npm test

# Type-check and verify code formatting
npm run check

# Re-format all files with Prettier
npm run format

# (Optional) Re-crawl Apple developer documentation and rebuild index
npm run build:index
```

The test suite runs via Node.js native test runner (`node --test`) covering **72 tests** with zero external test runner dependencies.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) &copy; 2026 Andrew Mason.
