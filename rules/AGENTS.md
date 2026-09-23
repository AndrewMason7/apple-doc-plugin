# Apple Development Guidelines & Documentation Rules

When assisting with Apple platform development (iOS, macOS, watchOS, tvOS, visionOS, Swift, SwiftUI, UIKit, AppKit):

## 1. Verify Apple APIs Before Proposing Code

- Never hallucinate or guess API names, function signatures, or view modifiers.
- Use `search_symbols` from the `apple-docs` toolset to look up exact symbol names, parameter labels, and platform availability.
- Use `get_documentation` to check parameter semantics, deprecation notices, and return types.

## 2. Prefer Modern Apple Frameworks & APIs

- Use modern replacements for deprecated APIs:
  - Prefer `NavigationStack` / `NavigationSplitView` over `NavigationView`.
  - Prefer `@Observable` (Observation framework) over `ObservableObject` / `@Published` in iOS 17+.
  - Prefer Swift Concurrency (`async`/`await`, `Task`, `AsyncStream`) over completion handlers.
  - Prefer `SwiftData` over boilerplate Core Data stacks for new models.

## 3. Query Efficiency

- Use wildcard syntax (`search_symbols(query: "Grid*")`) when the exact type name is partially known.
- Scope by framework (`framework: "SwiftUI"`) when looking for framework-specific implementations of common names (e.g. `Table` or `Button`).
