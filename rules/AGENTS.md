# Apple Development Guidelines & Documentation Rules

When assisting with Apple platform development (iOS, macOS, watchOS, tvOS, visionOS, Swift, SwiftUI, UIKit, AppKit):

## 1. Verify Apple APIs Before Proposing Code

- Never hallucinate or guess API names, function signatures, or view modifiers.
- Use `search_symbols` from the `apple-docs` toolset when the symbol name is known or partially known (`Grid*`).
- **Use `semantic_search` when the exact API name is unknown**: Describe the desired behavior, UI requirement, or concept in plain English (e.g. `"background location updates while screen is off"`, `"prevent sheet swipe dismiss"`, `"secure keychain token storage"`). The underlying Gemini hybrid search engine will map your conceptual description to the exact Apple API symbols.
- Use `get_documentation` to check parameter semantics, Swift declarations, deprecation notices, and return types.

## 2. Prefer Modern Apple Frameworks & APIs

- Use modern replacements for deprecated APIs:
  - Prefer `NavigationStack` / `NavigationSplitView` over `NavigationView`.
  - Prefer `@Observable` (Observation framework) over `ObservableObject` / `@Published` in iOS 17+.
  - Prefer Swift Concurrency (`async`/`await`, `Task`, `AsyncStream`) over completion handlers.
  - Prefer `SwiftData` over boilerplate Core Data stacks for new models.

## 3. Query Efficiency & Discovery Strategy

- **Known Symbols**: `search_symbols(query: "NavigationSplitView")` or `search_symbols(query: "Grid*")`.
- **Unknown API / Feature Requirement**: `semantic_search(query: "biometric face id login")` or `semantic_search(query: "three column sidebar split view diagram")`.
- **Cross-Framework Mapping**: If thinking in React/Web or Android terminology, use `semantic_search(query: "react useEffect equivalent")` or `semantic_search(query: "shared preferences local storage")` to find Apple SDK equivalents.
- **Framework Scoping**: Scope by framework (`framework: "SwiftUI"`) when looking for framework-specific implementations of common names (e.g. `Table` or `Button`).
