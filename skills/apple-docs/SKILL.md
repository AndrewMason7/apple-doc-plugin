---
name: apple-docs
description: 'Instant access to Apple Developer Documentation for iOS, iPadOS, macOS, watchOS, visionOS, and tvOS frameworks via the apple-docs MCP server. Use when searching for Apple APIs, symbols, methods, view modifiers, or reading DocC documentation for SwiftUI, UIKit, AppKit, SwiftData, Foundation, Combine, Observation, and more.'
---

# Apple Developer Documentation Skill

This skill provides expert guidance on searching and reading Apple Developer Documentation using the local `apple-docs` Model Context Protocol (MCP) server.

The server operates over a pre-indexed SQLite database with FTS5 BM25 search across 100,000+ symbols, wildcard support, DocC Markdown extraction, and multimodal layout previews.

---

## 🛠️ Available MCP Tools

| Tool                    | Purpose                                                                                                      | Key Arguments                                                           |
| :---------------------- | :----------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `search_symbols`        | **Primary Tool**. Instant sub-millisecond search across symbols with wildcard and optional semantic scoring. | `query` (required), `framework`, `symbolType`, `platform`, `maxResults` |
| `get_documentation`     | Fetches full DocC documentation and converts it to clean Markdown.                                           | `path` (required)                                                       |
| `discover_technologies` | Lists and filters available frameworks/technologies.                                                         | `query`, `page`, `pageSize`                                             |
| `choose_technology`     | Scopes subsequent lookups to a specific framework.                                                           | `name` or `identifier`                                                  |
| `current_technology`    | Inspects currently scoped framework.                                                                         | None                                                                    |
| `get_version`           | Checks MCP server version and features.                                                                      | None                                                                    |

---

## 🔍 Search Best Practices

### 1. Symbol Search (`search_symbols`)

Use `search_symbols` first whenever looking for an Apple type, protocol, method, or property:

- **Exact / Partial Lookup**:
  ```json
  { "query": "NavigationSplitView" }
  ```
- **Scoped by Framework**:
  ```json
  { "query": "Table", "framework": "SwiftUI" }
  ```
- **Wildcard Queries**:
  - `*` matches 0 or more characters: `Grid*`, `*Item`, `UI*View`
  - `?` matches a single character: `v?1`
- **Filtering by Symbol Kind**:
  ```json
  { "query": "Observable", "symbolType": "protocol" }
  ```
- **Conceptual Intent Search**:
  If Gemini semantic search is configured (`GEMINI_API_KEY`), queries like `"background location updates"` or `"diffable data source"` leverage vector embeddings alongside FTS5.

### 2. Reading Documentation (`get_documentation`)

When you know the symbol name or relative path:

```json
{ "path": "documentation/swiftui/view/task(priority:_:)" }
```

or simply:

```json
{ "path": "NavigationSplitView" }
```

The server resolves the path against the local database and returns structured Markdown including:

- Declaration signature
- Overview & parameters
- Deprecation warnings and minimum OS versions
- Topics and related APIs

### 3. Visual Previews & Diagrams

When a symbol includes Apple design previews or layout figures, the response includes an inline Markdown image link:

```markdown
![Visual Preview](https://developer.apple.com/assets/elements/icons/swiftui/...)
```

Render and display these previews to the user when discussing UI design and layout structure.

---

## ⚡ Workflow Recommendations

1. **Verify Before Coding**: Never guess Apple API availability or signatures. Run `search_symbols` to verify exact parameter names, iOS/macOS version availability, and whether an API has been deprecated.
2. **Swift 6 & Modern Frameworks**: Look up modern equivalents for deprecated patterns (e.g. `NavigationStack` instead of `NavigationView`, `Observable` instead of `ObservableObject`, `SwiftData` instead of legacy Core Data setups).
3. **Global First**: You do not need to call `choose_technology` first. `search_symbols` searches across all core frameworks globally by default.
