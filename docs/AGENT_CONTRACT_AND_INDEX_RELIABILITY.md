# Agent-to-Tool Contract & Index Reliability Architecture

This document details the architectural diagnosis, root-cause fixes, data integrity migrations, and live verification results for the `apple-doc-plugin` SQLite search engine and Model Context Protocol (MCP) tool contract.

---

## 1. Executive Summary & Measured Smoking Guns

Prior to this refactor, agents frequently failed to retrieve core Apple documentation symbols (e.g., `NavigationStack`, `View`, `interactiveDismissDisabled`). Analysis of `data/apple-docs.db` and the handler logic identified several critical discrepancies between agent query conventions and internal tool contracts:

| Issue                      | Measured Symptom                                          | Root Cause                                                                                                                                      |
| :------------------------- | :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title Resolution**       | `get_documentation({ path: "NavigationStack" })` missed.  | `getSymbolByPath` matched only exact paths (`/documentation/swiftui/navigationstack`) or IDs; bare symbol titles returned 0 rows.               |
| **Search Callability**     | Search results lacked runnable next-step commands.        | Output printed raw DocC signatures without formatted MCP tool invocations.                                                                      |
| **Kind Incompatibility**   | `symbolType: "func"` deleted 20,000+ methods.             | DocC indexes functions as `method`, `typemethod`, or `instancemethod`. Strict equality matching excluded all methods.                           |
| **Sticky State Hijacking** | Global searches scoped unexpectedly to prior frameworks.  | `targetFramework` inherited `state.getActiveTechnology()` across unrelated global tool calls.                                                   |
| **Database Discovery**     | `discover_technologies` showed arbitrary web metadata.    | Handler bypassed local SQLite counts and printed invalid tool syntax like `choose_technology "SwiftUI"`.                                        |
| **Corpus Pollution**       | Observation framework had 19,245 rows.                    | 18,440 Swift standard library symbols (`/documentation/swift/...`) were incorrectly tagged as `Observation` during DocC child ingestion.        |
| **Vector Demotion**        | Exact symbol matches demoted under tutorial images.       | Sparse vector corpus (24 rows) combined with Reciprocal Rank Fusion (RRF) caused low-confidence semantic matches to outrank exact lexical hits. |
| **Error Contract**         | Missing symbols returned success without `isError: true`. | Missing symbol lookups returned tutorial fallbacks with HTTP 200 equivalent instead of formal error flags.                                      |
| **Wildcard Stripping**     | `Grid*` and `Navigation*View` failed to glob.             | FTS5 sanitizer replaced `*` with spaces, turning `Navigation*View` into `Navigation AND View`.                                                  |

---

## 2. Architectural Changes

### 2.1 Symbol Resolution & Disambiguation (`src/server/db/database.ts`)

`AppleDocsDB.resolveSymbol` implements a multi-tier fallback ladder:

```
Input: pathOrTitle, [framework]
  │
  ├── 1. Exact ID or Path Match (Fast-path)
  │      SELECT * FROM symbols WHERE id = ? OR path = ?
  │
  ├── 2. Normalized Path Match (Case-Insensitive)
  │      Candidate prefixes: documentation/${framework}/${path}, documentation/${lowerFw}/${lowerPath}
  │
  ├── 3. Title Exact Match (Collisions Scoped)
  │      SELECT * FROM symbols WHERE title = ? [AND framework = ?]
  │      ├─ 1 Result  ──> Return symbol
  │      └─ >1 Results ──> Return candidates for disambiguation
  │
  └── 4. Suffix Match (Primary Types Elevated)
         WHERE path LIKE '%/' || ? ORDER BY is_primary_type DESC, length(path) ASC
```

If multiple candidates exist (e.g. `View` exists in SwiftUI, UIKit, and AppKit), the tool returns `isError: true` with runnable commands:

```markdown
Multiple symbols match "View". Please re-run with an explicit framework:

• SwiftUI: `get_documentation({ "path": "/documentation/swiftui/view", "framework": "SwiftUI" })`
• UIKit: `get_documentation({ "path": "/documentation/uikit/uiview", "framework": "UIKit" })`
• AppKit: `get_documentation({ "path": "/documentation/appkit/nsview", "framework": "AppKit" })`
```

### 2.2 DocC Kind Aliasing (`src/server/handlers/search-symbols.ts`)

A canonical alias map normalizes natural programming language terminology to DocC internal classifications:

```typescript
const KIND_ALIASES: Record<string, string[]> = {
	func: [
		'func',
		'method',
		'function',
		'typemethod',
		'instancemethod',
		'operator',
	],
	function: [
		'func',
		'method',
		'function',
		'typemethod',
		'instancemethod',
		'operator',
	],
	method: ['method', 'func', 'function', 'typemethod', 'instancemethod'],
	init: ['init', 'initializer', 'constructor'],
	initializer: ['init', 'initializer', 'constructor'],
	property: [
		'property',
		'var',
		'variable',
		'typeproperty',
		'instanceproperty',
		'associatedtype',
	],
	var: ['property', 'var', 'variable', 'typeproperty', 'instanceproperty'],
	type: ['struct', 'class', 'enum', 'protocol', 'typealias'],
	struct: ['struct', 'structure'],
	class: ['class'],
	protocol: ['protocol'],
	enum: ['enum', 'enumeration'],
	typealias: ['typealias'],
	modifier: ['method', 'func', 'viewmodifier'],
	article: ['article', 'overview', 'tutorial', 'guide', 'ui_preview'],
};
```

If a kind filter yields 0 matches, the engine falls back to displaying all matches with an informative notice (`Filter "<kind>" matched 0 symbols; showing all kinds`) rather than deleting results.

### 2.3 Universal Wildcard Globbing (`src/server/db/database.ts`)

Queries containing prefix (`Grid*`), suffix (`*Style`), infix (`Navigation*View`), or single-character wildcards (`Grid?tem`) are detected before FTS tokenization and routed directly to SQL `LIKE` pattern matching:

```typescript
if (
	/\w[*?]|[*?]\w/.test(trimmed) ||
	(!trimmed.includes(' ') && (trimmed.includes('*') || trimmed.includes('?')))
) {
	const pattern = trimmed
		.replace(/\*/g, '%')
		.replace(/\?/g, '_')
		.replace(/["']/g, '');
	return this.queryLikePattern(pattern, framework, limit);
}
```

Queries with pure punctuation (`::: *** ()`) are rejected cleanly with `[]` without triggering database errors.

### 2.4 Semantic Search Threshold Guard (`src/server/services/search/hybrid-search.ts`)

When `semantic_items` contains fewer than 100 vectors, RRF fusion is bypassed to prevent sparse vectors from polluting lexical precision:

```typescript
const minSemanticItems =
	options.minSemanticItems ?? this.minSemanticItems ?? 100;
const semanticItemCount = this.db.getSemanticItemCount();

if (semanticItemCount < minSemanticItems) {
	// Pure lexical fallback prevents demoting exact symbol matches under sparse media items
	return scoredFTS.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

The search handler prints a clear, transparent status banner:

```
Search Mode: Lexical fallback (semantic index has 24 items; symbol embeddings require build:index)
```

---

## 3. Data Integrity & Migration

### 3.1 Observation Framework Segregation

The ingestion logic previously assigned child references from Swift standard library to `Observation`. A SQL migration updated `data/apple-docs.db`:

```sql
UPDATE symbols SET framework = 'Swift' WHERE framework = 'Observation' AND (path LIKE '/documentation/swift%' OR id LIKE 'documentation/swift%' OR path LIKE '/documentation/updates/swift%');
UPDATE symbols SET framework = 'Synchronization' WHERE framework = 'Observation' AND (path LIKE '/documentation/synchronization%' OR id LIKE 'documentation/synchronization%');
UPDATE symbols SET framework = 'RegexBuilder' WHERE framework = 'Observation' AND (path LIKE '/documentation/regexbuilder%' OR id LIKE 'documentation/regexbuilder%');
UPDATE symbols SET framework = 'Distributed' WHERE framework = 'Observation' AND (path LIKE '/documentation/distributed%' OR id LIKE 'documentation/distributed%');
UPDATE symbols SET framework = 'Foundation' WHERE framework = 'Observation' AND (path LIKE '/documentation/foundation%' OR id LIKE 'documentation/foundation%');
UPDATE symbols SET framework = 'SwiftUI' WHERE framework = 'Observation' AND (path LIKE '/documentation/swiftui%' OR id LIKE 'documentation/swiftui%');
INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild');
```

**Results:**

- `Swift`: 18,444 symbols
- `Foundation`: 13,129 symbols
- `AppKit`: 12,709 symbols
- `UIKit`: 11,406 symbols
- `SwiftUI`: 7,205 symbols
- `Combine`: 1,065 symbols
- `SwiftData`: 559 symbols
- `CoreLocation`: 482 symbols
- `RegexBuilder`: 462 symbols
- `Synchronization`: 196 symbols
- `Distributed`: 93 symbols
- `Observation`: **37 symbols** (exact match for actual framework)
- **Total Database Symbols**: **65,787**

### 3.2 Ingestion Guard (`src/server/services/indexer.ts`)

Added `resolveFrameworkFromPath(path: string, fallback: string)` to prevent child references from inheriting the parent crawl framework during index updates.

---

## 4. Live MCP Verification

All tools verified via direct MCP execution on `apple-doc-plugin_apple-docs`:

### 4.1 `index_info`

```text
📊 Indexed Symbols: 65787
📦 Indexed Frameworks: AppKit, Combine, CoreLocation, Distributed, Foundation, Observation, RegexBuilder, Swift, SwiftData, SwiftUI, Synchronization, UIKit
✨ Embeddings Present: Yes (hybrid multimodal search enabled)
```

### 4.2 `discover_technologies`

```markdown
## Indexed Frameworks

### Swift

• **Identifier:** doc://com.apple.documentation/documentation/Swift
• **Symbols Indexed:** 18,444
• **Usage:** Pass `framework: "Swift"` to `semantic_search` or `search_symbols`

### Foundation

• **Identifier:** doc://com.apple.documentation/documentation/Foundation
• **Symbols Indexed:** 13,129
• **Usage:** Pass `framework: "Foundation"` to `semantic_search` or `search_symbols`

_Pagination_
• Next: `discover_technologies({ "query": "", "page": 2 })`
```

### 4.3 `search_symbols({ query: "Navigation*View", framework: "SwiftUI" })`

```markdown
# 🔍 Search Results for "Navigation\*View"

**Framework:** SwiftUI
**Search Mode:** Lexical only (SQLite FTS5)
**Query Mode:** wildcard
**Matches Found:** 2

## Symbols

### NavigationView (SwiftUI)

• **Kind:** struct
• **Path:** `/documentation/swiftui/navigationview`
• **Platforms:** iOS, iPadOS, Mac Catalyst, macOS, tvOS, visionOS, watchOS
• **Doc Call:** `get_documentation({ "path": "/documentation/swiftui/navigationview", "framework": "SwiftUI" })`

### NavigationSplitView (SwiftUI)

• **Kind:** struct
• **Path:** `/documentation/swiftui/navigationsplitview`
• **Platforms:** iOS, iPadOS, Mac Catalyst, macOS, tvOS, visionOS, watchOS
• **Doc Call:** `get_documentation({ "path": "/documentation/swiftui/navigationsplitview", "framework": "SwiftUI" })`
```

### 4.4 `search_symbols({ query: "interactiveDismissDisabled", symbolType: "func" })`

```markdown
# 🔍 Search Results for "interactiveDismissDisabled"

**Framework:** SwiftUI
**Search Mode:** Lexical only (SQLite FTS5)
**Query Mode:** keyword
**Matches Found:** 1

## Symbols

### func interactiveDismissDisabled(Bool) -> some View (SwiftUI)

• **Kind:** method
• **Path:** `/documentation/swiftui/view/interactivedismissdisabled(_:)`
• **Platforms:** iOS, iPadOS, Mac Catalyst, macOS, tvOS, visionOS, watchOS
• **Doc Call:** `get_documentation({ "path": "/documentation/swiftui/view/interactivedismissdisabled(_:)", "framework": "SwiftUI" })`
```

### 4.5 `get_documentation({ path: "NavigationStack" })`

Direct point lookup succeeds using bare symbol title:

````markdown
# NavigationStack

**Technology:** SwiftUI
**Type:** struct
**Platforms:** iOS 16.0, iPadOS 16.0, Mac Catalyst 16.0, macOS 13.0, tvOS 16.0, visionOS 1.0, watchOS 9.0

## Declaration

```swift
nonisolated struct NavigationStack<Data, Root> where Root : View
```
````

## Overview

A view that displays a root view and enables you to present additional views over the root view.

```

---

## 5. Test Suite & Verification Matrix

The test suite contains **95 automated tests** across 24 test suites with **100% pass rate**:

| Test Suite | Purpose | Status |
| :--- | :--- | :--- |
| `test/get-documentation-resolution.test.js` | Bare title, case-insensitive paths, and disambiguation | ✅ PASS |
| `test/search-snippet.test.js` | Runnable `Doc Call` formatting in search results | ✅ PASS |
| `test/kind-aliases.test.js` | `symbolType: "func"` mapping to DocC `method` and fallback | ✅ PASS |
| `test/session-scope.test.js` | Global search decoupling from sticky session state | ✅ PASS |
| `test/discover-counts.test.js` | Database symbol counts and valid tool pagination | ✅ PASS |
| `test/observation-integrity.test.js` | Zero foreign symbols in Observation framework | ✅ PASS |
| `test/semantic-guard.test.js` | Threshold bypass (<100 vectors) to protect exact lexical hits | ✅ PASS |
| `test/wildcards.test.js` | `Grid*`, `*Style`, `Navigation*View`, `Grid?tem` SQL LIKE globbing | ✅ PASS |
| `test/db-hardened.test.js` | Adversarial syntax character handling and corrupt JSON resilience | ✅ PASS |
| `test/stress-tribunal.test.js` | High-load concurrency, secret scrubbing, and buffer alignment | ✅ PASS |
| `test/e2e.test.js` | Full end-to-end integration across all MCP endpoints | ✅ PASS |

All changes pass `npm run check` (TypeScript typecheck + Prettier format validation).
```
