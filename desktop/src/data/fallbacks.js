/**
 * Apple Developer Documentation Studio — Fallback Data
 */

export const FALLBACK_STATS = {
	ok: true,
	version: '1.1.0',
	engine: 'hermes-native-sqlite-fts5',
	symbolCount: 95899,
	// Rule 17 (Hermes Catalog) strips dense vectors from the shipped binary; the
	// bundled `data/apple-docs.db` reports `semantic_item_count = 0`, so this
	// offline preview must not advertise hydrated embeddings it does not have.
	semanticItemCount: 0,
	frameworkCount: 30,
	mode: 'hybrid-idiom-fts5',
	idiomCount: 16,
	compilerRuleCount: 11,
	latencyMs: 2.8,
	// Mirrors `SELECT framework, COUNT(*) FROM symbols GROUP BY framework` on the
	// shipped `data/apple-docs.db` (sums to exactly 95,899 / 30 frameworks).
	frameworks: [
		{ name: 'Swift', symbolCount: 18442 },
		{ name: 'Foundation', symbolCount: 13013 },
		{ name: 'AppKit', symbolCount: 12654 },
		{ name: 'UIKit', symbolCount: 11449 },
		{ name: 'Security', symbolCount: 7331 },
		{ name: 'SwiftUI', symbolCount: 7202 },
		{ name: 'RealityKit', symbolCount: 6235 },
		{ name: 'AVFoundation', symbolCount: 5614 },
		{ name: 'WebKit', symbolCount: 3193 },
		{ name: 'Vision', symbolCount: 1915 },
		{ name: 'StoreKit', symbolCount: 1531 },
		{ name: 'AuthenticationServices', symbolCount: 1473 },
		{ name: 'MapKit', symbolCount: 1299 },
		{ name: 'CoreData', symbolCount: 1170 },
		{ name: 'Combine', symbolCount: 1062 },
		{ name: 'SwiftData', symbolCount: 552 },
		{ name: 'CoreLocation', symbolCount: 474 },
		{ name: 'RegexBuilder', symbolCount: 462 },
		{ name: 'LocalAuthentication', symbolCount: 246 },
		{ name: 'Synchronization', symbolCount: 196 },
		{ name: 'Distributed', symbolCount: 93 },
		{ name: 'BundleResources', symbolCount: 88 },
		{ name: 'ObjectiveC', symbolCount: 77 },
		{ name: 'AVFAudio', symbolCount: 45 },
		{ name: 'Observation', symbolCount: 37 },
		{ name: 'visionOS', symbolCount: 22 },
		{ name: 'Xcode', symbolCount: 11 },
		{ name: 'PassKit', symbolCount: 6 },
		{ name: 'WidgetKit', symbolCount: 4 },
		{ name: 'AVKit', symbolCount: 3 },
	],
};

export const FALLBACK_SYMBOLS = [
	{
		id: '/documentation/swiftui/navigationsplitview',
		title: 'NavigationSplitView',
		framework: 'SwiftUI',
		kind: 'struct',
		path: '/documentation/swiftui/navigationsplitview',
		platforms: [
			'iOS 16.0+',
			'iPadOS 16.0+',
			'macOS 13.0+',
			'tvOS 16.0+',
			'visionOS 1.0+',
			'watchOS 9.0+',
		],
		abstract:
			'A view that presents views in two or three columns, where selections in leading columns control presentations in subsequent columns.',
		declaration:
			'@MainActor @preconcurrency struct NavigationSplitView<Sidebar, Content, Detail> where Sidebar : View, Content : View, Detail : View',
		source: 'exact',
		webUrl:
			'https://developer.apple.com/documentation/swiftui/navigationsplitview',
	},
	{
		id: '/documentation/swiftui/view/interactivedismissdisabled(_:)',
		title: 'interactiveDismissDisabled(_:)',
		framework: 'SwiftUI',
		kind: 'method',
		path: '/documentation/swiftui/view/interactivedismissdisabled(_:)',
		platforms: [
			'iOS 15.0+',
			'iPadOS 15.0+',
			'macOS 12.0+',
			'tvOS 15.0+',
			'visionOS 1.0+',
			'watchOS 8.0+',
		],
		abstract:
			'Conditionally prevents interactive dismissal of presentations like popovers, sheets, and inspectors.',
		declaration:
			'nonisolated func interactiveDismissDisabled(_ isDisabled: Bool = true) -> some View',
		source: 'hybrid',
		webUrl:
			'https://developer.apple.com/documentation/swiftui/view/interactivedismissdisabled(_:)',
	},
	{
		id: '/documentation/swiftui/view/task(id:priority:_:)',
		title: 'task(id:priority:_:)',
		framework: 'SwiftUI',
		kind: 'method',
		path: '/documentation/swiftui/view/task(id:priority:_:)',
		platforms: [
			'iOS 15.0+',
			'iPadOS 15.0+',
			'macOS 12.0+',
			'tvOS 15.0+',
			'visionOS 1.0+',
			'watchOS 8.0+',
		],
		abstract:
			'Adds an asynchronous task to perform before this view appears or when a specified value changes, automatically cancelling when the view disappears.',
		declaration:
			'nonisolated func task<T>(id value: T, priority: TaskPriority = .userInitiated, _ action: @escaping () async -> Void) -> some View where T : Equatable',
		source: 'idiom-bridge',
		webUrl:
			'https://developer.apple.com/documentation/swiftui/view/task(id:priority:_:)',
	},
	{
		id: '/documentation/observation/observable()',
		title: '@Observable',
		framework: 'Observation',
		kind: 'macro',
		path: '/documentation/observation/observable()',
		platforms: [
			'iOS 17.0+',
			'iPadOS 17.0+',
			'macOS 14.0+',
			'tvOS 17.0+',
			'visionOS 1.0+',
			'watchOS 10.0+',
		],
		abstract:
			'Defines and implements conformance of the Observable protocol for fine-grained SwiftUI view invalidation without @Published boilerplate.',
		declaration:
			'@attached(member, names: ...) @attached(memberAttribute) @attached(extension, conformances: Observable) macro Observable()',
		source: 'exact',
		webUrl:
			'https://developer.apple.com/documentation/observation/observable()',
	},
	{
		id: '/documentation/swiftdata/model()',
		title: '@Model',
		framework: 'SwiftData',
		kind: 'macro',
		path: '/documentation/swiftdata/model()',
		platforms: [
			'iOS 17.0+',
			'iPadOS 17.0+',
			'macOS 14.0+',
			'tvOS 17.0+',
			'visionOS 1.0+',
			'watchOS 10.0+',
		],
		abstract:
			'Converts a Swift class into a stored model managed by SwiftData ModelContainer and reactive @Query views.',
		declaration:
			'@attached(member, names: ...) @attached(extension, conformances: PersistentModel) macro Model()',
		source: 'exact',
		webUrl: 'https://developer.apple.com/documentation/swiftdata/model()',
	},
	{
		id: '/documentation/swiftui/appstorage',
		title: 'AppStorage',
		framework: 'SwiftUI',
		kind: 'struct',
		path: '/documentation/swiftui/appstorage',
		platforms: [
			'iOS 14.0+',
			'iPadOS 14.0+',
			'macOS 11.0+',
			'tvOS 14.0+',
			'visionOS 1.0+',
			'watchOS 7.0+',
		],
		abstract:
			'A property wrapper type that reflects a value from UserDefaults and invalidates a view on a change in value in that UserDefaults.',
		declaration:
			'@frozen @propertyWrapper struct AppStorage<Value> : DynamicProperty',
		source: 'idiom-bridge',
		webUrl: 'https://developer.apple.com/documentation/swiftui/appstorage',
	},
	{
		id: '/documentation/security/secitemadd(_:_:)',
		title: 'SecItemAdd(_:_:)',
		framework: 'Security',
		kind: 'func',
		path: '/documentation/security/secitemadd(_:_:)',
		platforms: [
			'iOS 2.0+',
			'macOS 10.6+',
			'tvOS 9.0+',
			'visionOS 1.0+',
			'watchOS 2.0+',
		],
		abstract: 'Adds one or more items to a keychain.',
		declaration:
			'func SecItemAdd(_ attributes: CFDictionary, _ result: UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus',
		source: 'fts5',
		webUrl:
			'https://developer.apple.com/documentation/security/secitemadd(_:_:)',
	},
	{
		id: '/documentation/localauthentication/lacontext',
		title: 'LAContext',
		framework: 'LocalAuthentication',
		kind: 'class',
		path: '/documentation/localauthentication/lacontext',
		platforms: ['iOS 8.0+', 'macOS 10.10+', 'visionOS 1.0+', 'watchOS 3.0+'],
		abstract:
			'A mechanism for evaluating authentication policies and access controls using Face ID, Touch ID, or Optic ID.',
		declaration: 'class LAContext : NSObject',
		source: 'fts5',
		webUrl:
			'https://developer.apple.com/documentation/localauthentication/lacontext',
	},
];

export const FALLBACK_IDIOMS = [
	{
		idiom: 'useEffect',
		ecosystem: 'react',
		category: 'lifecycle',
		appleSymbols: [
			'task(id:priority:_:)',
			'onAppear(perform:)',
			'onChange(of:initial:_:)',
		],
		frameworks: ['SwiftUI'],
		description:
			'Structured async side-effects tied to view lifetime (auto-cancelled on disappear) and state observation.',
		snippet: '.task(id: query) {\n    await viewModel.load(query)\n}',
	},
	{
		idiom: 'useState / remember',
		ecosystem: 'react',
		category: 'state',
		appleSymbols: ['@State', '@Binding', '@Bindable'],
		frameworks: ['SwiftUI'],
		description:
			'Value-type local view state and two-way bindings into child views.',
		snippet: '@State private var isPresented = false',
	},
	{
		idiom: 'Redux / Zustand / ViewModel',
		ecosystem: 'react',
		category: 'state',
		appleSymbols: ['@Observable', '@Bindable', 'Environment'],
		frameworks: ['Observation', 'SwiftUI'],
		description:
			'Fine-grained property-level reactive stores using Swift 6 @Observable macro.',
		snippet:
			'@Observable final class AppStore {\n    var items: [Item] = []\n}',
	},
	{
		idiom: 'SharedPreferences / localStorage',
		ecosystem: 'android',
		category: 'storage',
		appleSymbols: ['@AppStorage', '@SceneStorage', 'UserDefaults'],
		frameworks: ['SwiftUI', 'Foundation'],
		description: 'Reactive UserDefaults-backed key-value preferences.',
		snippet: '@AppStorage("hasOnboarded") private var hasOnboarded = false',
	},
	{
		idiom: 'Room / Prisma / SQLite ORM',
		ecosystem: 'android',
		category: 'storage',
		appleSymbols: ['@Model', 'ModelContainer', 'ModelContext', '@Query'],
		frameworks: ['SwiftData', 'CoreData'],
		description:
			'Declarative Swift-native persistence and reactive @Query views.',
		snippet:
			'@Model final class Note {\n    var title: String\n    var createdAt: Date\n}',
	},
	{
		idiom: 'CSS Flexbox (display: flex)',
		ecosystem: 'web',
		category: 'layout',
		appleSymbols: ['HStack', 'VStack', 'ZStack', 'Spacer', 'Layout'],
		frameworks: ['SwiftUI'],
		description:
			'Directional stack layouts, flexible spacers, and custom Layout protocol composition.',
		snippet:
			'HStack(alignment: .center, spacing: 12) {\n    Text(title)\n    Spacer()\n}',
	},
	{
		idiom: 'CSS Grid (display: grid)',
		ecosystem: 'web',
		category: 'layout',
		appleSymbols: ['Grid', 'GridRow', 'LazyVGrid', 'GridItem'],
		frameworks: ['SwiftUI'],
		description: 'Two-dimensional Grid and viewport-virtualized LazyVGrid.',
		snippet:
			'LazyVGrid(columns: [GridItem(.adaptive(minimum: 160))]) {\n    ForEach(items) { Card(item: $0) }\n}',
	},
	{
		idiom: 'React Router / NavController',
		ecosystem: 'react',
		category: 'navigation',
		appleSymbols: ['NavigationStack', 'NavigationSplitView', 'NavigationPath'],
		frameworks: ['SwiftUI'],
		description:
			'Type-safe value-driven push routing and multi-column iPad/macOS split views.',
		snippet:
			'NavigationStack(path: $path) {\n    RootView().navigationDestination(for: Route.self) { ... }\n}',
	},
	{
		idiom: 'Kotlin Coroutines / Promise.all',
		ecosystem: 'android',
		category: 'concurrency',
		appleSymbols: [
			'Task',
			'withThrowingTaskGroup',
			'AsyncStream',
			'@MainActor',
		],
		frameworks: ['Swift', 'SwiftUI'],
		description:
			'Structured concurrency, actor isolation, and parallel child tasks.',
		snippet: 'await withThrowingTaskGroup(of: Data.self) { group in ... }',
	},
	{
		idiom: 'WebAuthn / BiometricPrompt',
		ecosystem: 'web',
		category: 'security',
		appleSymbols: ['LAContext', 'ASAuthorizationAppleIDProvider', 'SecItemAdd'],
		frameworks: ['LocalAuthentication', 'AuthenticationServices', 'Security'],
		description:
			'Face ID / Touch ID / Optic ID policies, Passkeys, and Keychain Services.',
		snippet:
			'try await LAContext().evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)',
	},
];

export const COMPILER_PRESETS = [
	{
		id: 'swiftui-nav',
		label: 'Deprecated SwiftUI Navigation + Modifiers',
		command: 'swift build',
		log: [
			"Sources/App/ContentView.swift:14:9: warning: 'NavigationView' was deprecated in iOS 16.0: use NavigationStack or NavigationSplitView instead",
			"Sources/App/ContentView.swift:22:14: error: value of type 'some View' has no member 'navigationBarItems'",
			"Sources/App/ContentView.swift:29:10: warning: 'foregroundColor' was deprecated in iOS 17.0: renamed to 'foregroundStyle'",
		].join('\n'),
	},
	{
		id: 'observation',
		label: 'Combine ObservableObject -> Swift 6 @Observable',
		command: 'xcodebuild -scheme MyApp build',
		log: [
			"Sources/ViewModels/FeedVM.swift:8:24: warning: 'ObservableObject' legacy pattern detected",
			"Sources/Views/FeedView.swift:12:6: warning: 'StateObject' was superseded for @Observable models",
			"Sources/Views/FeedView.swift:31:10: warning: 'onChange' single-argument closure was deprecated in iOS 17.0",
		].join('\n'),
	},
	{
		id: 'sheets-corners',
		label: 'Presentation & Clipping Diagnostics',
		command: 'swift test',
		log: [
			"Sources/SheetView.swift:9:18: warning: 'presentationMode' was deprecated in iOS 15.0: use EnvironmentValues.dismiss",
			"Sources/CardView.swift:19:14: warning: 'cornerRadius' was deprecated in iOS 17.0: use clipShape",
			"Sources/CardView.swift:21:14: warning: 'accentColor' was deprecated in iOS 16.0: use tint",
		].join('\n'),
	},
];

export const LOCAL_MIGRATIONS = {
	NavigationView: {
		replacement: 'NavigationStack / NavigationSplitView',
		framework: 'SwiftUI',
		docPath: '/documentation/swiftui/navigationstack',
		reason:
			'Deprecated in iOS 16 / macOS 13. Use NavigationStack for value-based push routing or NavigationSplitView for multi-column layouts.',
		fixSnippet:
			'NavigationStack {\n    ContentView()\n        .navigationDestination(for: Item.self) { DetailView(item: $0) }\n}',
	},
	navigationBarItems: {
		replacement: 'toolbar(content:) + ToolbarItem',
		framework: 'SwiftUI',
		docPath: '/documentation/swiftui/toolbaritem',
		reason:
			'.navigationBarItems(leading:trailing:) was removed/deprecated in favor of semantic .toolbar placements.',
		fixSnippet:
			'.toolbar {\n    ToolbarItem(placement: .confirmationAction) {\n        Button("Done", action: save)\n    }\n}',
	},
	foregroundColor: {
		replacement: 'foregroundStyle(_:)',
		framework: 'SwiftUI',
		docPath: '/documentation/swiftui/view/foregroundstyle(_:)',
		reason:
			'Deprecated in iOS 17 / macOS 14. Use .foregroundStyle(_:) for hierarchical colors, gradients, and materials.',
		fixSnippet: '.foregroundStyle(.secondary)',
	},
	ObservableObject: {
		replacement: '@Observable (Observation framework)',
		framework: 'Observation',
		docPath: '/documentation/observation/observable()',
		reason:
			'Prefer @Observable and @Bindable on iOS 17+ / macOS 14+ for property-level tracking.',
		fixSnippet:
			'import Observation\n\n@Observable final class FeedVM {\n    var posts: [Post] = []\n}',
	},
	StateObject: {
		replacement: '@State with @Observable class',
		framework: 'Observation',
		docPath: '/documentation/observation/observable()',
		reason:
			'With @Observable models, own instances with @State private var vm = FeedVM() instead of @StateObject.',
		fixSnippet: '@State private var vm = FeedVM()',
	},
	onChange: {
		replacement: 'onChange(of:initial:_:) two-parameter closure',
		framework: 'SwiftUI',
		docPath: '/documentation/swiftui/view/onchange(of:initial:_:)',
		reason:
			'Single-parameter .onChange(of:) { newValue in } was deprecated in iOS 17.',
		fixSnippet:
			'.onChange(of: selection) { oldValue, newValue in\n    handle(newValue)\n}',
	},
	presentationMode: {
		replacement: '@Environment(\\.dismiss)',
		framework: 'SwiftUI',
		docPath: '/documentation/swiftui/dismissaction',
		reason:
			'presentationMode is deprecated. Read @Environment(\\.dismiss) private var dismiss and call dismiss().',
		fixSnippet: '@Environment(\\.dismiss) private var dismiss',
	},
	cornerRadius: {
		replacement: 'clipShape(.rect(cornerRadius:))',
		framework: 'SwiftUI',
		docPath: '/documentation/swiftui/view/clipshape(_:style:)',
		reason:
			'Deprecated in iOS 17. Use .clipShape(.rect(cornerRadius: 12, style: .continuous)).',
		fixSnippet: '.clipShape(.rect(cornerRadius: 12, style: .continuous))',
	},
	accentColor: {
		replacement: 'tint(_:)',
		framework: 'SwiftUI',
		docPath: '/documentation/swiftui/view/tint(_:)',
		reason: 'Deprecated in favor of .tint(_:) across SwiftUI controls.',
		fixSnippet: '.tint(.accentColor)',
	},
};
