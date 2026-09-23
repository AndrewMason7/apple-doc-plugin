# Apple Platform Modernization & Migration Guide

This reference provides complete before-and-after patterns for modernizing legacy Apple platform code to contemporary Swift 6 and modern iOS / macOS frameworks.

---

## 1. SwiftUI Navigation: `NavigationView` → `NavigationStack` / `NavigationSplitView`

> [!WARNING]
> `NavigationView` was deprecated in iOS 16 / macOS 13. It causes severe stack desynchronization, double-push bugs on iPad/Mac, and broken programmatic navigation.

### Single-Column (iPhone / Stack Navigation)

#### ❌ Deprecated (`NavigationView`)
```swift
NavigationView {
    List(items) { item in
        NavigationLink(destination: DetailView(item: item)) {
            Text(item.name)
        }
    }
    .navigationTitle("Items")
}
```

#### ✅ Modern (`NavigationStack` with typed destinations)
```swift
@State private var navigationPath = NavigationPath()

NavigationStack(path: $navigationPath) {
    List(items) { item in
        NavigationLink(value: item) {
            Text(item.name)
        }
    }
    .navigationTitle("Items")
    .navigationDestination(for: Item.self) { item in
        DetailView(item: item)
    }
}
```

### Multi-Column (iPad / Mac / Split Navigation)

#### ✅ Modern (`NavigationSplitView`)
```swift
@State private var selectedCategory: Category?
@State private var selectedItem: Item?

NavigationSplitView {
    List(categories, selection: $selectedCategory) { category in
        Text(category.name).tag(category)
    }
    .navigationTitle("Categories")
} content: {
    if let selectedCategory {
        List(selectedCategory.items, selection: $selectedItem) { item in
            Text(item.name).tag(item)
        }
        .navigationTitle(selectedCategory.name)
    } else {
        Text("Select a category")
    }
} detail: {
    if let selectedItem {
        DetailView(item: selectedItem)
    } else {
        Text("Select an item")
    }
}
```

---

## 2. State Management: `ObservableObject` → Observation (`@Observable`)

> [!IMPORTANT]
> The Observation framework (`@Observable`, introduced in iOS 17 / macOS 14 / Swift 5.9) replaces `Combine`-based `ObservableObject`. It eliminates view invalidation over-rendering by tracking only properties that a view actually reads in its `body`.

### Model Definition

#### ❌ Legacy (`ObservableObject` & `@Published`)
```swift
import Combine

class UserProfileViewModel: ObservableObject {
    @Published var name: String = ""
    @Published var age: Int = 0
    @Published var isLoading: Bool = false
    
    func update() { ... }
}
```

#### ✅ Modern (`@Observable`)
```swift
import Observation

@Observable
final class UserProfileViewModel {
    var name: String = ""
    var age: Int = 0
    var isLoading: Bool = false
    
    // Properties that should NOT trigger UI updates can be opted out
    @ObservationIgnored var internalCache: [String: Any] = [:]
}
```

### View Consumption

#### ❌ Legacy View
```swift
struct UserProfileView: View {
    @StateObject private var viewModel = UserProfileViewModel()
    // Or @ObservedObject var viewModel: UserProfileViewModel
    
    var body: some View {
        TextField("Name", text: $viewModel.name)
    }
}
```

#### ✅ Modern View
```swift
struct UserProfileView: View {
    @State private var viewModel = UserProfileViewModel()
    
    var body: some View {
        // Use @Bindable for two-way bindings to observable properties
        @Bindable var vm = viewModel
        TextField("Name", text: $vm.name)
    }
}
```

---

## 3. Data Persistence: Core Data → `SwiftData`

> [!NOTE]
> SwiftData uses modern Swift macros (`@Model`) to declare persistent schema directly in Swift code without `.xcdatamodeld` XML files.

### Schema Definition

#### ❌ Legacy Core Data (`NSManagedObject`)
```swift
// Required external xcdatamodeld XML configuration + generated code
public class CDRecipe: NSManagedObject {
    @NSManaged public var title: String?
    @NSManaged public var createdAt: Date?
    @NSManaged public var ingredients: NSSet?
}
```

#### ✅ Modern SwiftData (`@Model`)
```swift
import SwiftData

@Model
final class Recipe {
    var title: String
    var createdAt: Date
    @Relationship(deleteRule: .cascade) var ingredients: [Ingredient] = []
    
    init(title: String, createdAt: Date = .now) {
        self.title = title
        self.createdAt = createdAt
    }
}
```

### Querying in SwiftUI

#### ✅ Modern SwiftData (`@Query`)
```swift
import SwiftUI
import SwiftData

struct RecipeListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Recipe.createdAt, order: .reverse) private var recipes: [Recipe]
    
    var body: some View {
        List {
            ForEach(recipes) { recipe in
                Text(recipe.title)
            }
            .onDelete { indexSet in
                for index in indexSet {
                    modelContext.delete(recipes[index])
                }
            }
        }
    }
}
```

---

## 4. Asynchronous Code: Completion Handlers → Swift Concurrency

### Function Definition

#### ❌ Legacy Completion Handler
```swift
func fetchUserData(userId: String, completion: @escaping (Result<UserData, Error>) -> Void) {
    URLSession.shared.dataTask(with: url) { data, response, error in
        if let error = error {
            completion(.failure(error))
            return
        }
        guard let data = data else {
            completion(.failure(URLError(.badServerResponse)))
            return
        }
        do {
            let decoded = try JSONDecoder().decode(UserData.self, from: data)
            completion(.success(decoded))
        } catch {
            completion(.failure(error))
        }
    }.resume()
}
```

#### ✅ Modern Async / Await
```swift
func fetchUserData(userId: String) async throws -> UserData {
    let (data, response) = try await URLSession.shared.data(from: url)
    guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
        throw URLError(.badServerResponse)
    }
    return try JSONDecoder().decode(UserData.self, from: data)
}
```

### SwiftUI Task Lifecycle

#### ✅ Modern `.task` Modifier
```swift
struct ProfileView: View {
    @State private var userData: UserData?
    let userId: String
    
    var body: some View {
        Group {
            if let userData {
                Text(userData.name)
            } else {
                ProgressView()
            }
        }
        // .task automatically starts when the view appears and cancels if the view disappears
        .task(id: userId) {
            do {
                userData = try await fetchUserData(userId: userId)
            } catch {
                // Handle cancellation cleanly
            }
        }
    }
}
```

---

## 5. Bridging Legacy APIs with Continuations

When calling third-party or legacy Apple SDKs that only offer completion blocks, wrap them with checked continuations:

```swift
func fetchLegacyRecord(id: String) async throws -> Record {
    try await withCheckedThrowingContinuation { continuation in
        legacySDK.loadRecord(id: id) { record, error in
            if let error {
                continuation.resume(throwing: error)
            } else if let record {
                continuation.resume(returning: record)
            } else {
                continuation.resume(throwing: CommonError.unknown)
            }
        }
    }
}
```
