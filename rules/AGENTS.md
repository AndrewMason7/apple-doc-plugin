# Apple Development Guidelines & Documentation Rules

When assisting with Apple platform development (iOS, macOS, watchOS, tvOS, visionOS, Swift, SwiftUI, UIKit, AppKit):

## 1. Always Prefer `semantic_search` for Apple APIs

- **PRIMARY SEARCH TOOL**: Always use `semantic_search` as your default tool for discovering, searching, and verifying Apple APIs, framework symbols, and UI patterns.
- `semantic_search` leverages hybrid vector embeddings (768-d Gemini or local offline EmbeddingGemma) fused with SQLite FTS5. It understands both exact API names (`NavigationSplitView`) and natural language concepts (`"prevent sheet swipe dismiss"`, `"dismiss keyboard on tap outside"`). **Ranking quality depends on the provider**: the behavioral examples below were verified with Gemini; the local 270M GGUF model misses many intent-style paraphrases. Always read the **Search Mode** banner in the result.
- **Indexed Coverage**: The offline index contains **95,899 symbols** across all 21 core frameworks, with full C function and Swift method resolution including `Security` (`SecItemAdd`), `WebKit` (`WKWebView`), `AVFoundation` (`AVPlayer`), `StoreKit` (`SKPaymentQueue`), `MapKit` (`MKMapView`), `CoreData` (`NSManagedObject`), `RealityKit` (`Entity`), `Vision` (`VNRecognizeTextRequest`), `AuthenticationServices`, and `LocalAuthentication` (`LAContext`). Symbols resolve with complete signature and availability metadata via `search_symbols` and `get_documentation`. The bundled vector artifact provides 19,473 dense embeddings for core frameworks (SwiftUI, UIKit, Foundation, AppKit, etc.), while lexical search and DocC lookup span all 95,899 symbols. Run `index_info` for live counts.
- **Secondary Tool (`search_symbols`)**: Only use `search_symbols` when you specifically require raw wildcard globbing (`Grid*`, `*Style`). For all other queries, prefer `semantic_search`.
- **Never Hallucinate APIs**: Never guess API names, function signatures, or view modifiers. Always verify with `semantic_search` or `get_documentation`.
- Use `get_documentation` to check parameter semantics, Swift declarations, deprecation notices, and return types. Pass bare symbol titles (`path: "NavigationStack"`) directly, or copy the exact runnable `Doc Call` from search results. When a symbol name is ambiguous across frameworks, specify `framework`.

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
- **Framework Scoping**: Scope by framework (`framework: "SwiftUI"`) when looking for framework-specific implementations of common names (e.g. `Table` or `Button`). Pass `framework` directly on the tool call.
- **Raw Wildcard Matching Only**: Use `search_symbols(query: "Grid*")` or `search_symbols(query: "*Style")` when globbing prefixes/suffixes.
