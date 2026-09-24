# Apple Development Guidelines & Documentation Rules

When assisting with Apple platform development (iOS, macOS, watchOS, tvOS, visionOS, Swift, SwiftUI, UIKit, AppKit):

## 1. Always Prefer `semantic_search` for Apple APIs

- **PRIMARY SEARCH TOOL**: Always use `semantic_search` as your default tool for discovering, searching, and verifying Apple APIs, framework symbols, and UI patterns.
- `semantic_search` leverages Gemini 3072-dimensional hybrid vector embeddings fused with SQLite FTS5. It understands both exact API names (`NavigationSplitView`) and natural language concepts (`"prevent sheet swipe dismiss"`, `"secure keychain token storage"`).
- **Secondary Tool (`search_symbols`)**: Only use `search_symbols` when you specifically require raw wildcard globbing (`Grid*`, `*Style`). For all other queries, prefer `semantic_search`.
- **Never Hallucinate APIs**: Never guess API names, function signatures, or view modifiers. Always verify with `semantic_search` or `get_documentation`.
- Use `get_documentation` to check parameter semantics, Swift declarations, deprecation notices, and return types.

## 2. Prefer Modern Apple Frameworks & APIs

- Use modern replacements for deprecated APIs:
  - Prefer `NavigationStack` / `NavigationSplitView` over `NavigationView`.
  - Prefer `@Observable` (Observation framework) over `ObservableObject` / `@Published` in iOS 17+.
  - Prefer Swift Concurrency (`async`/`await`, `Task`, `AsyncStream`) over completion handlers.
  - Prefer `SwiftData` over boilerplate Core Data stacks for new models.

## 3. Query Efficiency & Discovery Strategy

- **Default / Primary Search**: `semantic_search(query: "NavigationSplitView")` or `semantic_search(query: "prevent sheet swipe dismiss")`.
- **Behavioral & Conceptual Queries**: `semantic_search(query: "biometric face id login")` or `semantic_search(query: "three column sidebar split view diagram")`.
- **Cross-Framework Mapping**: If thinking in React/Web or Android terminology, use `semantic_search(query: "react useEffect equivalent")` or `semantic_search(query: "shared preferences local storage")` to find Apple SDK equivalents.
- **Framework Scoping**: Scope by framework (`framework: "SwiftUI"`) when looking for framework-specific implementations of common names (e.g. `Table` or `Button`). Pass `framework` directly on the tool call; `choose_technology` is optional and not required.
- **Raw Wildcard Matching Only**: Use `search_symbols(query: "Grid*")` or `search_symbols(query: "*Style")` when globbing prefixes/suffixes.
