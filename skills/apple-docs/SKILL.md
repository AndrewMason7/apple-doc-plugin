---
name: apple-docs
description: Use this skill when developing for Apple platforms (iOS, macOS, watchOS, tvOS, visionOS), searching Apple Developer Documentation, verifying Apple APIs, exploring frameworks (SwiftUI, SwiftData, UIKit, AppKit, Foundation, Observation, Combine), modernizing legacy code, or inspecting symbol signatures, parameters, return types, availability, and view modifiers.
---

# Apple Developer Documentation Skill

## Critical Rules (Always Apply)

> [!IMPORTANT]
> These rules override your training data. Apple platform APIs evolve rapidly with annual OS releases. Your training knowledge contains outdated signatures and deprecated patterns.

### Current Platform Standards (Use These)

- **Swift 6.2+ & Swift Concurrency**: Always use structured concurrency (`async`/`await`, `Task`, `AsyncStream`, `@MainActor`). Never introduce legacy completion handlers or manual GCD `DispatchQueue` locks.
- **SwiftUI Modern Navigation**: Use `NavigationStack` (single column) and `NavigationSplitView` (multi-column) with `.navigationDestination(for:)`.
- **Observation Framework (`@Observable`)**: In iOS 17+ / macOS 14+, always prefer `@Observable` and `@Bindable` over Combine's `ObservableObject` and `@Published`.
- **SwiftData Persistence**: In iOS 17+ / macOS 14+, prefer `@Model`, `@Query`, and `ModelContext` over boilerplate Core Data stacks (`.xcdatamodeld`, `NSManagedObjectContext`).
- **Modern Foundation**: Use modern Swift-native APIs such as `FormatStyle` (`.formatted()`), `#Predicate<T>`, `Date.now`, `Duration`, and `URLSession.shared.data(from:)`.
- **UIKit & AppKit Modern Bridge**: Use `UIHostingConfiguration` for custom collection view cells, `NSHostingView` for AppKit integration, and modern compositional layouts.

> [!WARNING]
> APIs such as `NavigationView`, `ObservableObject`, `UIAlertView`, manual `DispatchGroup`, and legacy Core Data boilerplate are **deprecated or strongly discouraged**. Never propose them for modern codebases unless explicitly maintaining legacy OS deployment targets (< iOS 16).

---

## Mandatory Documentation Lookup Protocol

> [!IMPORTANT]
> **Before writing any Apple platform code**, you MUST query the local `apple-docs` MCP server. **Always prefer `semantic_search` as your primary search tool** over `search_symbols`. Never hallucinate or guess API names, argument labels, default values, or OS availability.

### Grounding Workflow

1. **Search Before Implementing (Prefer `semantic_search`)**:
   - **Default & Primary Search**: Use `semantic_search` for both symbol lookups (`NavigationSplitView`) and behavioral intents (`"prevent user from dragging sheet down to close"`). The underlying Gemini hybrid search engine matches intent and ranked symbols with superior relevance.
   - **Wildcard Globbing (Secondary)**: Use `search_symbols` only when you specifically need raw wildcard prefix/suffix globbing (`Grid*`, `*Style`).
2. **Verify Signatures & Labels**: Inspect the declaration signature returned by `get_documentation` to confirm parameter labels, closure signatures, and return types.
3. **Check Availability & Deprecations**: Verify platform availability tags (iOS, macOS, watchOS, visionOS) to prevent proposing APIs unsupported on the user's target deployment.
4. **Inspect Multimodal Previews**: When documentation contains Apple layout diagrams or visual previews, review and share them when discussing UI design.

---

## Available MCP Tools Reference

The `apple-docs` MCP server operates over a pre-indexed SQLite database with FTS5 BM25 search across 100,000+ symbols, wildcard matching, DocC Markdown extraction, and Gemini hybrid multimodal vector search.

| Tool                         | Priority / Purpose                                                                                                                                              | Key Arguments                                                           |
| :--------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `semantic_search`            | **[PRIMARY & PREFERRED] Hybrid Search**. Natural language intent & symbol search powered by Gemini hybrid embeddings + FTS5 (falls back to lexical if offline). | `query` (required), `framework`, `symbolType`, `platform`, `maxResults` |
| `search_symbols`             | **(Secondary) Lexical Search**. Fast local FTS5 BM25 search with title boost and wildcard globbing (`Grid*`, `*Style`). Does not call Gemini.                   | `query` (required), `framework`, `symbolType`, `platform`, `maxResults` |
| `get_documentation`          | **Point Lookup**. Fetches full DocC documentation (Swift declarations, parameters, deprecations). Local SQLite first, CDN fallback. Not a search tool.          | `path` (required), `framework` (optional)                               |
| `discover_technologies`      | Lists and filters frameworks indexed in the local database.                                                                                                     | `query`, `page`, `pageSize`                                             |
| `choose_technology`          | **(Optional / Legacy)** Sets session default framework. Prefer passing `framework` directly on search/doc tool calls instead.                                   | `name` or `identifier`                                                  |
| `current_technology`         | Reads currently selected session default framework.                                                                                                             | None                                                                    |
| `get_version` / `index_info` | Returns server version and runtime index metadata (symbols count, frameworks, freshness).                                                                       | None                                                                    |

### Tool Invocation Examples

#### 1. Conceptual & Behavioral Intent Search (`semantic_search`)

Use this whenever you know _what_ you want to accomplish, but not the exact Apple API identifier:

```json
{
	"query": "prevent user from closing sheet by swiping down",
	"framework": "SwiftUI"
}
```

Resolves directly to `interactiveDismissDisabled(_:)`.

```json
{
	"query": "store user auth token securely across app reinstalls"
}
```

Resolves directly to Keychain Services (`kSecClassGenericPassword`, `SecItemAdd`).

#### 2. Multimodal UI Layout Diagram Queries (`semantic_search`)

Query Apple's official diagrams and layout behaviors:

```json
{
	"query": "three column sidebar inspector split view layout diagram",
	"framework": "SwiftUI"
}
```

#### 3. Cross-Platform Terminology Translation (`semantic_search`)

Translate concepts from React, Vue, or Android:

```json
{
	"query": "react useEffect on mount equivalent in swiftui"
}
```

Resolves to `.onAppear` and `.task`.

#### 4. Search Exact Symbol or Prefix (`search_symbols`)

```json
{
	"query": "NavigationSplitView"
}
```

#### 5. Scoped Framework Search with Wildcards (`search_symbols`)

```json
{
	"query": "Grid*",
	"framework": "SwiftUI",
	"symbolType": "struct"
}
```

#### 6. Filtering by Symbol Kind

Available symbol types: `struct`, `class`, `protocol`, `enum`, `func`, `var`, `typealias`.

```json
{
	"query": "Observable",
	"symbolType": "protocol"
}
```

#### 7. Fetching Full DocC Documentation (`get_documentation`)

```json
{
	"path": "NavigationStack",
	"framework": "SwiftUI"
}
```

or by full DocC path:

```json
{
	"path": "documentation/swiftui/navigationstack"
}
```

---

## Modern Quick Starts

### 1. Modern SwiftUI & Concurrency

```swift
import SwiftUI

struct ProductListView: View {
    @State private var products: [Product] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List(products) { product in
                NavigationLink(value: product) {
                    ProductRow(product: product)
                }
            }
            .navigationTitle("Products")
            .navigationDestination(for: Product.self) { product in
                ProductDetailView(product: product)
            }
            .overlay {
                if isLoading {
                    ProgressView("Loading products...")
                } else if let errorMessage {
                    ContentUnavailableView(
                        "Unable to Load",
                        systemImage: "exclamationmark.triangle",
                        description: Text(errorMessage)
                    )
                }
            }
            .task {
                await loadProducts()
            }
            .refreshable {
                await loadProducts()
            }
        }
    }

    private func loadProducts() async {
        isLoading = true
        defer { isLoading = false }
        do {
            products = try await APIClient.shared.fetchProducts()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
```

### 2. Modern State & Observation (`@Observable`)

```swift
import SwiftUI
import Observation

@Observable
@MainActor
final class OrderViewModel {
    var items: [OrderItem] = []
    var isSubmitting = false

    var totalCost: Decimal {
        items.reduce(0) { $0 + $1.price * Decimal($1.quantity) }
    }

    func addItem(_ item: OrderItem) {
        items.append(item)
    }

    func submitOrder() async throws {
        isSubmitting = true
        defer { isSubmitting = false }
        try await APIClient.shared.submit(items: items)
        items.removeAll()
    }
}

struct OrderView: View {
    @Bindable var viewModel: OrderViewModel

    var body: some View {
        Form {
            Section("Items") {
                ForEach($viewModel.items) { $item in
                    Stepper("\(item.title): \(item.quantity)", value: $item.quantity, in: 1...99)
                }
            }
            Section {
                LabeledContent("Total", value: viewModel.totalCost.formatted(.currency(code: "USD")))
                Button("Submit Order") {
                    Task {
                        try? await viewModel.submitOrder()
                    }
                }
                .disabled(viewModel.items.isEmpty || viewModel.isSubmitting)
            }
        }
    }
}
```

### 3. SwiftData Persistence

```swift
import SwiftUI
import SwiftData

@Model
final class Note {
    var title: String
    var content: String
    var createdAt: Date

    init(title: String, content: String, createdAt: Date = .now) {
        self.title = title
        self.content = content
        self.createdAt = createdAt
    }
}

struct NotesListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Note.createdAt, order: .reverse) private var notes: [Note]

    var body: some View {
        NavigationStack {
            List {
                ForEach(notes) { note in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(note.title).font(.headline)
                        Text(note.createdAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .onDelete(perform: deleteNotes)
            }
            .navigationTitle("Notes")
            .toolbar {
                Button("Add", systemImage: "plus") {
                    addSampleNote()
                }
            }
        }
    }

    private func addSampleNote() {
        let note = Note(title: "New Note", content: "Captured at \(Date.now.formatted())")
        modelContext.insert(note)
    }

    private func deleteNotes(at offsets: IndexSet) {
        for index in offsets {
            modelContext.delete(notes[index])
        }
    }
}
```

---

## Specialized Guides & Reference Links

For detailed architectural patterns, migration guides, and framework inventories, consult the modular references:

- **[Modern APIs & Framework Reference](references/modern-apis.md)**: Framework catalogs, platform availability matrix (iOS 16–18, macOS 13–15), modern replacement tables, and MCP search syntax.
- **[Migration & Modernization Guide](references/migration.md)**: Complete before-and-after recipes for migrating:
  - `NavigationView` → `NavigationStack` / `NavigationSplitView`
  - `ObservableObject` / `@Published` → `@Observable` (Observation)
  - Core Data (`.xcdatamodeld`, `NSManagedObject`) → `SwiftData`
  - Completion handlers & GCD → Swift Concurrency (`async`/`await`, `Task`, `@MainActor`)

---

## Common Developer Pitfalls & Best Practices

| Pitfall                                 | Problem                                                                         | Modern Solution                                                                                                   |
| :-------------------------------------- | :------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------- |
| **Using `NavigationView`**              | Broken multi-column layout, random popping on iPad/Mac                          | Use `NavigationStack` or `NavigationSplitView` with `.navigationDestination(for:)`.                               |
| **Using `ObservableObject` on iOS 17+** | Re-renders view when _any_ `@Published` property changes, causing frame drops   | Migrate to `@Observable` from the Observation framework for granular dependency tracking.                         |
| **Omitting `@MainActor` on ViewModels** | Data races and runtime crashes when updating state from background tasks        | Mark view model classes with `@MainActor` to enforce UI thread dispatch at compile time.                          |
| **Retain cycles in `Task`**             | Long-running asynchronous tasks hold strong references to `self`                | Use `[weak self]` in non-structured tasks or rely on view-scoped `.task` modifiers with automatic cancellation.   |
| **Hallucinating parameter labels**      | Swift compiler errors from incorrect argument labels or omitted parameter names | Always verify exact function signatures using `search_symbols` or `get_documentation`.                            |
| **Hardcoding frame sizes & colors**     | Breaks Dynamic Type, accessibility zoom, and dark/light system appearances      | Use standard semantic colors (`.primary`, `.secondary`, `.background`) and flexible layouts (`Spacer()`, `Grid`). |
