# Apple Modern APIs & Framework Reference Guide

This reference provides a comprehensive catalog of modern Apple platform frameworks, platform availability matrices, and modern replacement patterns for legacy APIs.

---

## 1. Core Framework Catalog

The local `apple-docs` MCP database indexes symbol signatures, docstrings, deprecation notices, and parameters across the core Apple developer frameworks:

| Framework        | Primary Scope & Role                                   | Recommended Modern Patterns                                                                             |
| :--------------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| **SwiftUI**      | Declarative user interfaces across all Apple platforms | `NavigationStack`, `NavigationSplitView`, `Grid`, `Table`, `.task`, `.sensoryFeedback`, `.inspector`    |
| **SwiftData**    | Modern Swift-native persistence & data modeling        | `@Model`, `@Query`, `ModelContainer`, `ModelContext`, `#Predicate`                                      |
| **Observation**  | High-performance state management (iOS 17+)            | `@Observable`, `@Bindable`, `@Environment` (per-property invalidation tracking)                         |
| **Foundation**   | Core data types, formatting, networking, file I/O      | `URLSession.shared.data(from:)`, `FormatStyle`, `Predicate`, `Date.now`, `Duration`                     |
| **UIKit**        | iOS imperative UI and system bridging                  | `UIHostingConfiguration`, `UICollectionViewCompositionalLayout`, `UIContentUnavailableConfiguration`    |
| **AppKit**       | macOS imperative UI and desktop integration            | `NSHostingView`, `NSMenuItem`, modern window management, menu item actions                              |
| **Combine**      | Functional reactive event streams                      | Prefer Swift Concurrency (`AsyncStream`, `AsyncSequence`) unless maintaining existing Combine pipelines |
| **CoreLocation** | Location and geofencing services                       | Modern `CLLocationUpdate.liveUpdates()` async sequence (iOS 17+)                                        |

---

## 2. Platform Availability Matrix

Always verify minimum platform requirements before proposing code. Use `get_documentation` to confirm deployment targets.

| Modern API                                | iOS   | macOS | watchOS | tvOS  | visionOS | Replaces                                                     |
| :---------------------------------------- | :---- | :---- | :------ | :---- | :------- | :----------------------------------------------------------- |
| `NavigationStack` / `NavigationSplitView` | 16.0+ | 13.0+ | 9.0+    | 16.0+ | 1.0+     | `NavigationView`                                             |
| `@Observable` (Observation)               | 17.0+ | 14.0+ | 10.0+   | 17.0+ | 1.0+     | `ObservableObject` / `@Published`                            |
| `SwiftData` (`@Model`, `@Query`)          | 17.0+ | 14.0+ | 10.0+   | 17.0+ | 1.0+     | Core Data (`.xcdatamodeld`, `NSManagedObject`)               |
| `.task(priority:_:)`                      | 15.0+ | 12.0+ | 8.0+    | 15.0+ | 1.0+     | `.onAppear` + `DispatchQueue.main.async`                     |
| `.refreshable(action:)`                   | 15.0+ | 12.0+ | 8.0+    | —     | 1.0+     | `UIRefreshControl` bridging                                  |
| `ContentUnavailableView`                  | 17.0+ | 14.0+ | 10.0+   | 17.0+ | 1.0+     | Custom empty state stacks                                    |
| `UIHostingConfiguration`                  | 16.0+ | —     | —       | 16.0+ | 1.0+     | Custom `UITableViewCell` / `UICollectionViewCell` subclasses |
| `CLLocationUpdate.liveUpdates()`          | 17.0+ | 14.0+ | 10.0+   | 17.0+ | 1.0+     | `CLLocationManagerDelegate` delegate callbacks               |
| `FormatStyle` (`formatted()`)             | 15.0+ | 12.0+ | 8.0+    | 15.0+ | 1.0+     | `DateFormatter`, `NumberFormatter`                           |

---

## 3. Modern Replacements for Legacy Patterns

### UI & Layout

| Legacy Pattern                                       | Modern Replacement                                                   | Rationale                                                                    |
| :--------------------------------------------------- | :------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| `NavigationView`                                     | `NavigationStack` or `NavigationSplitView`                           | Eliminates split-view desync, column collapse, and nested presentation bugs. |
| `Form` with nested `Group` hacks                     | `Form` with `Section(header:footer:)` & `LabeledContent`             | Native layout grouping with built-in accessibility semantics.                |
| `UIAlertView` / `ActionSheet`                        | `.alert(isPresented:actions:message:)` or `.confirmationDialog(...)` | Declarative presentation tied directly to view state.                        |
| Manual cell sizing (`UITableViewAutomaticDimension`) | `UIHostingConfiguration` inside `UICollectionView`                   | Embeds SwiftUI views directly inside UIKit cells with automatic sizing.      |
| Manual scroll offset observation                     | `.scrollPosition(...)` / `.scrollTargetBehavior(...)` (iOS 17+)      | Native declarative scroll physics, pagination, and offset tracking.          |

### Data, State & Concurrency

| Legacy Pattern                                     | Modern Replacement                                 | Rationale                                                                                  |
| :------------------------------------------------- | :------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| `ObservableObject` + `@Published`                  | `@Observable` (Observation)                        | Eliminates re-evaluating body when unread properties change; simplifies syntax.            |
| `DispatchQueue.global().async`                     | `Task { ... }` or `Task.detached { ... }`          | Structured concurrency with automatic cooperative cancellation and priority propagation.   |
| `DispatchQueue.main.async`                         | `@MainActor` or `await MainActor.run { ... }`      | Compiler-enforced thread safety under Swift 6 data race prevention.                        |
| Completion handlers (`(Result<T, Error>) -> Void`) | `async throws -> T`                                | Cleaner control flow, native `try/catch`, no forgotten completion blocks.                  |
| `NSNotificationCenter` observers                   | `NotificationCenter.default.notifications(named:)` | Consumes notifications as an `AsyncSequence` with automatic cancellation.                  |
| Core Data `NSFetchRequest` / `NSPredicate`         | SwiftData `@Query` / `#Predicate<T>`               | Type-safe queries validated at compile time, eliminating runtime string predicate crashes. |

---

## 4. MCP Search & Discovery Protocol

When querying the `apple-docs` MCP server, use targeted strategies for highest precision:

### 1. Framework Scoping

Common symbols like `Table`, `Button`, or `Color` exist across multiple frameworks (`SwiftUI`, `AppKit`, `UIKit`). Always scope when searching generic terms:

```json
{
	"query": "Table",
	"framework": "SwiftUI"
}
```

### 2. Wildcard Syntax

The FTS5 search engine supports fast prefix and infix wildcard queries:

- `Grid*` → Matches `Grid`, `GridRow`, `GridItem`, `GridView`
- `*Navigation*` → Matches `NavigationStack`, `NavigationSplitView`, `NavigationLink`
- `UI*Controller` → Matches `UIViewController`, `UINavigationController`, `UITabBarController`

### 3. Symbol Type Filtering

Filter by the exact Swift construct to cut through noise:

- `struct`: Value types, SwiftUI views (`View`, `Text`, `VStack`)
- `protocol`: Abstractions and conformances (`View`, `Observable`, `Identifiable`)
- `class`: Reference types (`NSWindow`, `UIViewController`, `ModelContext`)
- `func` / `var`: View modifiers, methods, and properties

```json
{
	"query": "inspector",
	"framework": "SwiftUI",
	"symbolType": "func"
}
```

### 4. Direct Symbol Resolution

When inspecting full documentation, pass either:

- The symbol name: `{"path": "NavigationSplitView"}`
- The full DocC path: `{"path": "documentation/swiftdata/modelcontext"}`
