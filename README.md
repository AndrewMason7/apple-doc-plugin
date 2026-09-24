# Apple Doc MCP & Index Plugin

A high-performance Model Context Protocol (MCP) server providing instant offline access to Apple's Developer Documentation with embedded SQLite FTS5 search, wildcard support, and optional Gemini semantic embeddings.

---

## ✨ Features

- **🚀 Sub-Millisecond Symbol Search**: Pre-indexed SQLite database with FTS5 BM25 scoring over 100,000+ symbols across core Apple frameworks (SwiftUI, UIKit, Foundation, SwiftData, Combine, AppKit, Observation, CoreLocation).
- **🌐 Global Search by Default**: AI agents can search symbols immediately without being forced to run `choose_technology` first.
- **🎯 Scoped Search When Desired**: Search across all frameworks or narrow down by passing `framework: "SwiftUI"` or calling `choose_technology`.
- **🖼️ Multimodal UI Layout Previews**: Uses `gemini-embedding-2`'s unified text+vision vector space to embed Apple's diagrams, layout previews, and HIG screenshots. Agents can query visual concepts and receive rendered `![Visual Preview](...)` markdown inline.
- **🧠 Hybrid Semantic Search (Optional)**: If `GEMINI_API_KEY` or Google Application Default Credentials (ADC) are provided, combines lexical BM25 ranking and 3072-dimensional vector similarities via Reciprocal Rank Fusion (RRF).
- **🔒 Zero-Config Offline Fallback**: Fully functional 100% offline without any API keys or network requests needed for symbol searches.
- **📄 Clean Markdown Doc Extraction**: On-demand retrieval and conversion of Apple's DocC AST into concise, context-optimized Markdown.

---

## 🛠️ Available MCP Tools

| Tool                    | Description                                                                                                                                                                                                                                                               |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `search_symbols`        | **Primary Tool**. Instant search across symbols with exact-name boosting, wildcard matching (`*`, `?`), and optional semantic intent queries. `framework` parameter is optional.                                                                                          |
| `get_documentation`     | Fetches rich documentation for a symbol or path (e.g., `NavigationStack` or `documentation/swiftui/view`), including Swift syntax declarations, parameters, deprecation warnings with modern replacements, and official code examples. `framework` parameter is optional. |
| `discover_technologies` | Browse and filter available Apple technologies/frameworks.                                                                                                                                                                                                                |
| `choose_technology`     | Optionally scope subsequent searches to a specific framework (backward compatible).                                                                                                                                                                                       |
| `current_technology`    | View the currently selected technology scope.                                                                                                                                                                                                                             |
| `get_version`           | Report MCP server version.                                                                                                                                                                                                                                                |

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

- **`apple-docs` MCP Server**: Registered and active for all sessions.
- **`apple-docs` Skill**: Best practice procedures for searching Apple APIs and DocC docs.
- **Apple Platform Rules**: Enforces API verification and modern framework patterns.

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

_(Note: `GEMINI_API_KEY` and ADC are optional. If omitted, pure local SQLite FTS5 runs offline.)_

### Environment Configuration

Copy the template to create your local `.env`:

```bash
cp .env.example .env
```

| Variable                         | Required | Description                                                                                                                                                          |
| :------------------------------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                 | Optional | Google Gemini API key for multimodal 3072-dim embeddings (`gemini-embedding-2`). Get one at [Google AI Studio](https://aistudio.google.com/).                        |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional | Path to Service Account JSON key for Google Application Default Credentials (ADC). Alternatively, `gcloud auth application-default login` is detected automatically. |
| `APPLE_DOCS_DB_PATH`             | Optional | Custom path to the SQLite index database (defaults to `data/apple-docs.db`).                                                                                         |

_(Note: The server automatically loads `.env` natively at startup. If neither `GEMINI_API_KEY` nor ADC credentials are provided, the engine runs pure local SQLite FTS5 offline.)_

### Local Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run unit, integration, and E2E test suite
npm test

# (Optional) Re-crawl and update the pre-indexed Apple SDK database
npm run build:index
```

---

## 🔍 Search Examples for Agents

- **Exact Symbol Lookup**: `search_symbols(query: "NavigationSplitView")`
- **Scoped Framework Search**: `search_symbols(query: "ViewController", framework: "UIKit")`
- **Wildcard Prefix/Suffix**: `search_symbols(query: "Grid*")` or `search_symbols(query: "*Item")`
- **Conceptual Intent Search**: `search_symbols(query: "background location updates")`
