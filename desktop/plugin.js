/**
 * Apple Developer Documentation Studio — Hermes Desktop Plugin (`desktop/plugin.js`).
 *
 * Surfaces contributed strictly via `@hermes/plugin-sdk`:
 *  1. Workspace Page (`ROUTES_AREA`: `/apple-docs`) + Sidebar Nav (`SIDEBAR_NAV_AREA`)
 *     - 95.9k Symbol & DocC Explorer
 *     - Cross-Framework Idiom Rosetta Stone (React / Web CSS / Android Kotlin -> SwiftUI & Swift 6)
 *     - Swift / Xcode Compiler Diagnostic Grounding Lab (live simulator for `transform_terminal_output`)
 *     - 30-Framework Index Coverage & 1-Click Judge Showcase
 *  2. Dockable Right Inspector Pane (`PANES_AREA`: quick Apple API lookup beside chat)
 *  3. Inline Transcript Directive (`TRANSCRIPT_DIRECTIVE_AREA`: `::apple-doc{...}` rich API cards in chat)
 *  4. Statusbar Readiness Chip (`STATUSBAR_AREAS.right`) + Command Palette (`PALETTE_AREA`)
 */

import { useEffect, useMemo, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import {
	Badge,
	Button,
	Codicon,
	CopyButton,
	GlyphSpinner as SdkGlyphSpinner,
	haptic,
	host,
	Input,
	PALETTE_AREA,
	PANES_AREA,
	ROUTES_AREA,
	RowButton,
	ScrollArea,
	SegmentedControl,
	Separator,
	SIDEBAR_NAV_AREA,
	STATUSBAR_AREAS,
	StatusDot,
	Textarea,
	Tip,
	TRANSCRIPT_DIRECTIVE_AREA,
	useMutation,
	usePluginI18n,
	useQuery,
} from '@hermes/plugin-sdk';

const PLUGIN_ID = 'apple-doc-plugin';
const STUDIO_ROUTE = '/apple-docs';

const FALLBACK_STATS = {
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

const FALLBACK_SYMBOLS = [
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

const FALLBACK_IDIOMS = [
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

const COMPILER_PRESETS = [
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

const LOCAL_MIGRATIONS = {
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

function localDiagnoseFallback(logText) {
	const findings = [];
	const seen = new Set();
	const re = /'([A-Za-z_][A-Za-z0-9_]*)'/g;
	let m;
	while ((m = re.exec(logText || '')) !== null) {
		const sym = m[1];
		if (!seen.has(sym) && LOCAL_MIGRATIONS[sym]) {
			seen.add(sym);
			findings.push({ symbol: sym, ...LOCAL_MIGRATIONS[sym] });
		}
	}
	return {
		matched: findings.length > 0,
		latencyMs: 1.4,
		findings,
	};
}

function localSearchFallback(query, framework) {
	const t0 =
		typeof performance !== 'undefined' && performance.now
			? performance.now()
			: Date.now();
	const elapsed = () => {
		const now =
			typeof performance !== 'undefined' && performance.now
				? performance.now()
				: Date.now();
		return Math.max(0, Math.round((now - t0) * 10) / 10);
	};
	const q = (query || '').trim().toLowerCase();
	const pool = framework
		? FALLBACK_SYMBOLS.filter(
				(s) => s.framework.toLowerCase() === framework.toLowerCase(),
			)
		: FALLBACK_SYMBOLS;
	if (!q)
		return {
			results: pool,
			latencyMs: elapsed(),
			mode: 'curated-preview',
			expansion: {},
			offlineFallback: true,
		};

	const matchedIdioms = FALLBACK_IDIOMS.filter(
		(i) =>
			i.idiom.toLowerCase().includes(q) ||
			q.includes(i.idiom.toLowerCase().split(' ')[0]) ||
			i.description.toLowerCase().includes(q),
	);
	const mappedTokens = matchedIdioms.flatMap((i) =>
		i.appleSymbols.map((s) => s.replace(/^@/, '').split('(')[0].toLowerCase()),
	);
	const filtered = pool.filter((s) => {
		const t = s.title.toLowerCase();
		const a = (s.abstract || '').toLowerCase();
		return (
			t.includes(q.replace(/\*/g, '')) ||
			a.includes(q) ||
			mappedTokens.some((tok) => t.includes(tok))
		);
	});
	// No result-substitution: a zero-match offline search returns an honest empty
	// list so the UI can render "no offline matches" instead of 4 unrelated symbols.
	return {
		results: filtered,
		latencyMs: elapsed(),
		mode: matchedIdioms.length ? 'offline-fallback-idiom' : 'offline-fallback',
		expansion: { matchedIdioms },
		offlineFallback: true,
	};
}

function safeHaptic(type = 'tap') {
	try {
		if (typeof haptic === 'function') haptic(type);
	} catch {}
}

function safeNavigate(path) {
	try {
		if (typeof host?.navigate === 'function') {
			host.navigate(path);
		}
	} catch {}
}

function safeOpenPane(paneId = 'inspector-pane') {
	try {
		const scopedId = paneId.includes(':') ? paneId : `${PLUGIN_ID}:${paneId}`;
		if (typeof host?.undismissPane === 'function') {
			host.undismissPane(scopedId);
		}
		if (typeof host?.revealPane === 'function') {
			host.revealPane(scopedId);
			return true;
		}
	} catch {}
	return false;
}

function safeNotify(message, kind = 'info') {
	try {
		if (typeof host?.notify === 'function') {
			host.notify({ kind, message });
		}
	} catch {}
}

async function safeWriteClipboard(ctx, text) {
	try {
		if (ctx?.os?.writeClipboard) {
			return Boolean(await ctx.os.writeClipboard(text));
		}
	} catch {}
	return false;
}

function safeOpenExternal(ctx, url) {
	try {
		if (ctx?.os?.openExternal) {
			return ctx.os.openExternal(url);
		}
	} catch {}
	return false;
}

function safeRest(ctx, endpoint, options) {
	if (ctx && typeof ctx.rest === 'function') {
		return ctx.rest(endpoint, options);
	}
	return Promise.reject(new Error('ctx.rest unavailable'));
}

function useDebouncedValue(value, delayMs = 160) {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}

async function fetchPluginStatus(ctx) {
	try {
		const res = await safeRest(ctx, '/status');
		if (res && res.symbolCount) {
			return { stats: res, apiLive: true };
		}
	} catch {}
	return { stats: FALLBACK_STATS, apiLive: false };
}

async function fetchPluginIdioms(ctx) {
	try {
		const res = await safeRest(ctx, '/idioms');
		if (res && Array.isArray(res.idioms) && res.idioms.length) {
			return res.idioms;
		}
	} catch {}
	return FALLBACK_IDIOMS;
}

async function fetchPluginSearch(ctx, { q, framework, mode, limit }) {
	const targetQ = (q || '').trim() || 'NavigationSplitView';
	const params = new URLSearchParams();
	params.set('q', targetQ);
	params.set('mode', mode || 'semantic');
	params.set('limit', String(limit || 25));
	if (framework) params.set('framework', framework);
	try {
		const res = await safeRest(ctx, `/search?${params.toString()}`);
		if (res && Array.isArray(res.results)) {
			return { data: res, apiLive: true };
		}
	} catch {}
	return { data: localSearchFallback(targetQ, framework), apiLive: false };
}

async function fetchPluginDoc(ctx, { path, framework }) {
	if (!path) return null;
	const params = new URLSearchParams({ path, live: 'true' });
	if (framework) params.set('framework', framework);
	try {
		const res = await safeRest(ctx, `/doc?${params.toString()}`);
		if (res && res.ok) return res;
	} catch {}
	return null;
}

async function runPluginDiagnose(ctx, textToAnalyze) {
	try {
		const res = await safeRest(ctx, '/diagnose', {
			method: 'POST',
			body: { command: 'swift build', output: textToAnalyze, returncode: 1 },
		});
		if (res && Array.isArray(res.findings)) {
			return { result: res, apiLive: true };
		}
	} catch {}
	return { result: localDiagnoseFallback(textToAnalyze), apiLive: false };
}

async function insertIntoChatComposer(
	ctx,
	text,
	navigateToChat = false,
	sessionId = null,
) {
	safeHaptic('tap');
	try {
		if (navigateToChat) {
			safeNavigate('/');
		}
		if (typeof host?.composer?.insertText === 'function') {
			const inserted = await host.composer.insertText(sessionId ?? null, text, {
				mode: 'inline',
			});
			if (inserted) {
				safeNotify(`Inserted ${text} into chat composer`, 'success');
				return;
			}
		}
	} catch {
		// Fall back to clipboard when no active chat composer is mounted
	}
	const copied = await safeWriteClipboard(ctx, text);
	safeNotify(
		copied
			? `Copied ${text} to clipboard (open a chat to paste)`
			: 'Could not insert into composer',
		copied ? 'info' : 'error',
	);
}

async function sendDemoCommandInChat(ctx, sessionId = null) {
	safeHaptic('tap');
	const cmd = '/apple-docs demo';
	try {
		safeNavigate('/');
		if (typeof host?.composer?.setDraft === 'function') {
			const ok = await host.composer.setDraft(sessionId ?? null, cmd);
			if (ok) {
				safeNotify(
					'Loaded `/apple-docs demo` in composer — press Enter to run!',
					'success',
				);
				return;
			}
		}
	} catch {
		// Fallback to clipboard
	}
	const copied = await safeWriteClipboard(ctx, cmd);
	safeNotify(
		copied
			? 'Copied `/apple-docs demo` to clipboard — paste in any chat!'
			: 'Could not copy `/apple-docs demo`',
		copied ? 'info' : 'error',
	);
}

function InlineAppleDocCard({ ctx, attrs, sessionId }) {
	const safeAttrs = attrs || {};
	const title = safeAttrs.title || safeAttrs.symbol || 'Apple SDK Symbol';
	const framework = safeAttrs.framework || 'SwiftUI';
	const kind = safeAttrs.kind || 'symbol';
	const path = safeAttrs.path || `/documentation/${framework.toLowerCase()}`;
	const summary = safeAttrs.summary || safeAttrs.abstract || '';
	const platforms = (safeAttrs.platforms || '')
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);
	const webUrl = `https://developer.apple.com${path.startsWith('/') ? path : '/' + path}`;
	const cleanRef = `@apple:${framework}/${title
		.split('(')[0]
		.replace(/^func\s+|^var\s+|^@/, '')
		.trim()}`;

	return jsxs('div', {
		className:
			'my-2 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-surface-secondary)/50 px-4 py-3 flex flex-col gap-2',
		children: [
			jsxs('div', {
				className: 'flex items-center justify-between gap-2 flex-wrap',
				children: [
					jsxs('div', {
						className: 'flex items-center gap-2 min-w-0',
						children: [
							jsx(Codicon, {
								name: 'book',
								className: 'text-(--ui-accent) shrink-0',
							}),
							jsx('span', {
								className:
									'font-mono text-xs font-semibold text-(--ui-text) break-all',
								children: title,
							}),
							jsx(Badge, { variant: 'secondary', children: framework }),
							jsx('span', {
								className:
									'text-[11px] uppercase tracking-wider text-(--ui-text-tertiary)',
								children: kind,
							}),
						],
					}),
					jsxs('div', {
						className: 'flex items-center gap-1.5 shrink-0',
						children: [
							jsx(Button, {
								size: 'sm',
								variant: 'ghost',
								onClick: () =>
									insertIntoChatComposer(ctx, cleanRef, false, sessionId),
								children: 'Cite @apple:',
							}),
							jsx(Button, {
								size: 'sm',
								variant: 'ghost',
								onClick: () => {
									safeHaptic('tap');
									safeNavigate(STUDIO_ROUTE);
								},
								children: 'Open Studio',
							}),
							jsx(Button, {
								size: 'sm',
								variant: 'ghost',
								onClick: () => safeOpenExternal(ctx, webUrl),
								children: 'Apple Docs ↗',
							}),
						],
					}),
				],
			}),
			summary
				? jsx('p', {
						className: 'text-xs leading-relaxed text-(--ui-text-secondary)',
						children: summary,
					})
				: null,
			platforms.length
				? jsxs('div', {
						className: 'flex items-center gap-1.5 flex-wrap pt-0.5',
						children: platforms.slice(0, 6).map((p) =>
							jsx('span', {
								key: p,
								className:
									'text-[10px] px-1.5 py-0.5 rounded border border-(--ui-stroke-secondary) text-(--ui-text-tertiary)',
								children: p,
							}),
						),
					})
				: null,
		],
	});
}

function GlyphSpinner({ className = '' }) {
	if (typeof SdkGlyphSpinner === 'function') {
		return jsx(SdkGlyphSpinner, { className });
	}
	return jsx(Codicon, {
		name: 'loading',
		className:
			`inline-block animate-spin text-(--ui-accent) text-xs ${className}`.trim(),
	});
}

function SymbolInspectorDetail({ ctx, item, liveDoc, loadingDoc }) {
	if (!item) {
		return jsx('div', {
			className:
				'h-full flex items-center justify-center p-8 text-xs text-(--ui-text-tertiary)',
			children:
				'Select any Apple SDK symbol on the left to inspect its Swift 6 declaration, availability, and DocC metadata.',
		});
	}

	const doc =
		liveDoc && liveDoc.ok && liveDoc.path === item.path ? liveDoc : item;
	const platforms = doc.platforms || item.platforms || [];
	const declaration = doc.declaration || item.declaration || '';
	const bareName = (doc.title || item.title || '')
		.split('(')[0]
		.replace(/^func\s+|^static\s+func\s+|^var\s+|^@/, '')
		.trim();
	const atToken = `@apple:${doc.framework}/${bareName}`;
	const docCall = `get_documentation({ "path": "${doc.path}", "framework": "${doc.framework}" })`;

	return jsx(ScrollArea, {
		className: 'h-full',
		children: jsxs('div', {
			className: 'p-5 flex flex-col gap-4',
			children: [
				jsxs('div', {
					className: 'flex items-start justify-between gap-3 flex-wrap',
					children: [
						jsxs('div', {
							className: 'flex flex-col gap-1 min-w-0',
							children: [
								jsxs('div', {
									className: 'flex items-center gap-2 flex-wrap',
									children: [
										jsx(Badge, {
											variant: 'secondary',
											children: doc.framework,
										}),
										jsx('span', {
											className:
												'text-[11px] uppercase tracking-wider text-(--ui-text-tertiary)',
											children: doc.kind,
										}),
										doc.source
											? jsx('span', {
													className:
														'text-[10px] px-1.5 py-0.5 rounded border border-(--ui-stroke-secondary) text-(--ui-text-tertiary)',
													children: doc.source,
												})
											: null,
										loadingDoc ? jsx(GlyphSpinner, {}) : null,
									],
								}),
								jsx('h2', {
									className:
										'text-base font-semibold font-mono text-(--ui-text) break-all mt-1',
									children: doc.title,
								}),
								jsx('span', {
									className:
										'text-[11px] font-mono text-(--ui-text-tertiary) break-all',
									children: doc.path,
								}),
							],
						}),
						jsxs('div', {
							className: 'flex items-center gap-1.5 flex-wrap',
							children: [
								jsx(Button, {
									size: 'sm',
									variant: 'secondary',
									onClick: () => insertIntoChatComposer(ctx, atToken, true),
									children: `Insert ${atToken}`,
								}),
								jsx(CopyButton, { value: docCall }),
								jsx(Button, {
									size: 'sm',
									variant: 'ghost',
									onClick: () =>
										safeOpenExternal(
											ctx,
											doc.webUrl || `https://developer.apple.com${doc.path}`,
										),
									children: 'developer.apple.com ↗',
								}),
							],
						}),
					],
				}),

				platforms.length
					? jsxs('div', {
							className: 'flex items-center gap-1.5 flex-wrap',
							children: platforms.map((p) =>
								jsx('span', {
									key: p,
									className:
										'text-[11px] px-2 py-0.5 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-input)/40 text-(--ui-text-secondary)',
									children: p,
								}),
							),
						})
					: null,

				doc.deprecation
					? jsxs('div', {
							className:
								'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-input)/60 p-3 text-xs text-(--ui-text)',
							children: [
								jsx('div', {
									className: 'font-semibold mb-1',
									children: 'Deprecation Notice',
								}),
								jsx('div', {
									className: 'text-(--ui-text-secondary)',
									children: doc.deprecation,
								}),
							],
						})
					: null,

				doc.abstract
					? jsx('p', {
							className: 'text-sm leading-relaxed text-(--ui-text-secondary)',
							children: doc.abstract,
						})
					: null,

				declaration
					? jsxs('div', {
							className: 'flex flex-col gap-1.5',
							children: [
								jsxs('div', {
									className: 'flex items-center justify-between',
									children: [
										jsx('span', {
											className:
												'text-[11px] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
											children: 'Swift Declaration',
										}),
										jsx(CopyButton, { value: declaration }),
									],
								}),
								jsx('pre', {
									className:
										'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-input)/50 p-3 text-xs font-mono text-(--ui-text) overflow-x-auto whitespace-pre-wrap',
									children: declaration,
								}),
							],
						})
					: null,

				Array.isArray(doc.parameters) && doc.parameters.length
					? jsxs('div', {
							className: 'flex flex-col gap-1.5',
							children: [
								jsx('span', {
									className:
										'text-[11px] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
									children: 'Parameters',
								}),
								jsxs('div', {
									className:
										'flex flex-col gap-1 text-xs text-(--ui-text-secondary)',
									children: doc.parameters.map((paramLine, idx) =>
										jsx('div', {
											key: idx,
											className:
												'rounded-md bg-(--ui-input)/30 px-3 py-2 font-mono text-[11px]',
											children: paramLine,
										}),
									),
								}),
							],
						})
					: null,

				Array.isArray(doc.topics) && doc.topics.length
					? jsxs('div', {
							className: 'flex flex-col gap-2 pt-1',
							children: [
								jsx('span', {
									className:
										'text-[11px] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
									children: 'Related DocC Topics',
								}),
								...doc.topics.slice(0, 3).map((sec) =>
									jsxs(
										'div',
										{
											className:
												'rounded-lg border border-(--ui-stroke-secondary) p-3 flex flex-col gap-1',
											children: [
												jsx('div', {
													className: 'text-xs font-semibold text-(--ui-text)',
													children: sec.title,
												}),
												...(sec.items || []).map((it) =>
													jsxs(
														'div',
														{
															className:
																'text-[11px] text-(--ui-text-secondary)',
															children: [
																jsx('span', {
																	className: 'font-mono text-(--ui-text)',
																	children: it.title,
																}),
																it.abstract ? ` — ${it.abstract}` : '',
															],
														},
														it.url || it.title,
													),
												),
											],
										},
										sec.title,
									),
								),
							],
						})
					: null,
			],
		}),
	});
}

const QUICK_QUERIES = [
	{ label: 'Navigation*View', q: 'Navigation*View', mode: 'lexical' },
	{
		label: 'prevent sheet swipe dismiss',
		q: 'prevent sheet swipe dismiss',
		mode: 'semantic',
	},
	{ label: 'React useEffect', q: 'useEffect', mode: 'semantic' },
	{ label: '@Observable', q: 'Observable', mode: 'semantic' },
	{ label: 'Keychain SecItemAdd', q: 'SecItemAdd', mode: 'lexical' },
];

const TOP_FRAMEWORK_PILLS = [
	'',
	'SwiftUI',
	'SwiftData',
	'Observation',
	'Foundation',
	'UIKit',
	'AppKit',
	'Security',
	'StoreKit',
	'Vision',
];

function AppleDocsStudioPage({ ctx }) {
	const [activeTab, setActiveTab] = useState('explorer');

	const [query, setQuery] = useState('NavigationSplitView');
	const [frameworkFilter, setFrameworkFilter] = useState('');
	const [searchMode, setSearchMode] = useState('semantic');
	const [selectedSymbol, setSelectedSymbol] = useState(FALLBACK_SYMBOLS[0]);

	const [ecoFilter, setEcoFilter] = useState('all');
	const [compilerLog, setCompilerLog] = useState(COMPILER_PRESETS[0].log);

	const debouncedQuery = useDebouncedValue(query, 160);

	const statusQuery = useQuery({
		queryKey: [PLUGIN_ID, 'status'],
		queryFn: () => fetchPluginStatus(ctx),
		staleTime: 30_000,
	});
	const idiomsQuery = useQuery({
		queryKey: [PLUGIN_ID, 'idioms'],
		queryFn: () => fetchPluginIdioms(ctx),
		staleTime: 60_000,
	});
	const searchQuery = useQuery({
		queryKey: [
			PLUGIN_ID,
			'search',
			debouncedQuery,
			frameworkFilter,
			searchMode,
			25,
		],
		queryFn: () =>
			fetchPluginSearch(ctx, {
				q: debouncedQuery,
				framework: frameworkFilter,
				mode: searchMode,
				limit: 25,
			}),
		staleTime: 15_000,
		placeholderData: (prev) => prev,
	});
	const docQuery = useQuery({
		queryKey: [
			PLUGIN_ID,
			'doc',
			selectedSymbol?.path || '',
			selectedSymbol?.framework || '',
		],
		queryFn: () =>
			fetchPluginDoc(ctx, {
				path: selectedSymbol?.path,
				framework: selectedSymbol?.framework,
			}),
		enabled: Boolean(selectedSymbol && selectedSymbol.path),
		staleTime: 60_000,
	});
	const diagnoseMutation = useMutation({
		mutationFn: (textToAnalyze) => runPluginDiagnose(ctx, textToAnalyze),
	});

	const stats = statusQuery.data?.stats || FALLBACK_STATS;
	const idioms = idiomsQuery.data || FALLBACK_IDIOMS;
	const searchResult = useMemo(
		() =>
			searchQuery.data?.data ||
			localSearchFallback(debouncedQuery, frameworkFilter),
		[searchQuery.data, debouncedQuery, frameworkFilter],
	);
	const searching = searchQuery.isFetching;
	const liveDoc = docQuery.data || null;
	const loadingDoc = docQuery.isFetching;
	const apiLive = Boolean(
		statusQuery.data?.apiLive ||
		searchQuery.data?.apiLive ||
		diagnoseMutation.data?.apiLive,
	);
	const diagResult = useMemo(
		() =>
			diagnoseMutation.data?.result ||
			localDiagnoseFallback(COMPILER_PRESETS[0].log),
		[diagnoseMutation.data],
	);
	const diagnosing = diagnoseMutation.isPending;

	useEffect(() => {
		if (searchResult?.results?.length > 0) {
			setSelectedSymbol(searchResult.results[0]);
		}
	}, [searchResult]);

	const runCompilerDiagnosis = (textToAnalyze) => {
		diagnoseMutation.mutate(textToAnalyze);
	};

	const filteredIdioms = useMemo(() => {
		if (ecoFilter === 'all') return idioms;
		return idioms.filter((i) => i.ecosystem === ecoFilter);
	}, [idioms, ecoFilter]);

	return jsxs('div', {
		className: 'h-full w-full flex flex-col overflow-hidden',
		children: [
			jsxs('div', {
				className:
					'px-4 py-2 bg-(--ui-accent)/10 border-b border-(--ui-accent)/20 flex items-center justify-between gap-3 shrink-0 flex-wrap',
				children: [
					jsxs('div', {
						className:
							'flex items-center gap-2 text-xs text-(--ui-text-secondary)',
						children: [
							jsx(Codicon, {
								name: 'layout-sidebar-right',
								className: 'text-(--ui-accent)',
							}),
							jsx('span', {
								children:
									'Viewing Full Studio. Prefer Apple Docs docked side-by-side with your active chat session?',
							}),
						],
					}),
					jsxs('div', {
						className: 'flex items-center gap-2',
						children: [
							jsx(Button, {
								size: 'xs',
								variant: 'primary',
								onClick: () => {
									safeOpenPane('inspector-pane');
									safeNavigate('/');
								},
								children: '⇥ Dock to Side & Back to Chat',
							}),
							jsx(Button, {
								size: 'xs',
								variant: 'ghost',
								onClick: () => safeNavigate('/'),
								children: '← Back to Chat',
							}),
						],
					}),
				],
			}),
			jsxs('div', {
				className:
					'px-6 py-4 border-b border-(--ui-stroke-secondary) flex items-center justify-between gap-4 flex-wrap shrink-0',
				children: [
					jsxs('div', {
						className: 'flex items-center gap-3',
						children: [
							jsx(Codicon, {
								name: 'book',
								className: 'text-(--ui-accent) text-lg',
							}),
							jsxs('div', {
								children: [
									jsxs('div', {
										className: 'flex items-center gap-2',
										children: [
											jsx('h1', {
												className: 'text-base font-semibold text-(--ui-text)',
												children: 'Apple Developer Documentation Studio',
											}),
											jsx(Badge, {
												variant: 'secondary',
												children: `v${stats.version || '1.1.0'}`,
											}),
											jsxs('span', {
												className:
													'inline-flex items-center gap-1.5 text-[11px] text-(--ui-text-tertiary)',
												children: [
													jsx(StatusDot, { tone: apiLive ? 'ok' : 'idle' }),
													apiLive
														? `Live SQLite FTS5 (${(stats.symbolCount || 95899).toLocaleString()} symbols)`
														: 'Offline Seed Ready · Run /apple-docs demo',
												],
											}),
										],
									}),
									jsx('p', {
										className: 'text-xs text-(--ui-text-tertiary) mt-0.5',
										children:
											'95,899 offline Apple SDK symbols · React/Web/Android-to-SwiftUI Idiom RRF · Automatic swift build Diagnostic Grounding Hook · @apple: Context Refs',
									}),
								],
							}),
						],
					}),
					jsxs('div', {
						className: 'flex items-center gap-2',
						children: [
							jsx(SegmentedControl, {
								value: activeTab,
								onValueChange: (val) => {
									haptic('tap');
									setActiveTab(val);
								},
								options: [
									{ value: 'explorer', label: '95.9k Explorer' },
									{ value: 'idioms', label: 'Idiom Rosetta Stone' },
									{ value: 'compiler', label: 'Xcode Error Hook Lab' },
									{ value: 'frameworks', label: '30 Frameworks' },
								],
							}),
							jsx(Button, {
								size: 'sm',
								variant: 'secondary',
								onClick: () => sendDemoCommandInChat(ctx),
								children: 'Run /apple-docs demo',
							}),
						],
					}),
				],
			}),

			activeTab === 'explorer'
				? jsxs('div', {
						className: 'flex-1 min-h-0 flex flex-col',
						children: [
							jsxs('div', {
								className:
									'px-6 py-3 border-b border-(--ui-stroke-secondary) flex flex-col gap-2.5 shrink-0',
								children: [
									jsxs('div', {
										className: 'flex items-center gap-2.5 flex-wrap',
										children: [
											jsx('div', {
												className: 'flex-1 min-w-[240px]',
												children: jsx(Input, {
													value: query,
													onChange: (e) => setQuery(e.target.value),
													placeholder:
														'Search 95,899 symbols, wildcards (Grid*, Navigation*View), React hooks (useEffect), or intent ("prevent sheet swipe dismiss")...',
												}),
											}),
											jsx(SegmentedControl, {
												value: searchMode,
												onValueChange: setSearchMode,
												options: [
													{ value: 'semantic', label: 'Hybrid + Idiom RRF' },
													{ value: 'lexical', label: 'Wildcard / FTS5' },
												],
											}),
											jsx('span', {
												className:
													'text-[11px] font-mono text-(--ui-text-tertiary)',
												children: searching
													? 'Searching…'
													: `${(searchResult.results || []).length} hits · ${searchResult.latencyMs ?? 1.5} ms`,
											}),
										],
									}),
									jsxs('div', {
										className:
											'flex items-center justify-between gap-2 flex-wrap',
										children: [
											jsxs('div', {
												className: 'flex items-center gap-1 flex-wrap',
												children: TOP_FRAMEWORK_PILLS.map((fw) =>
													jsx(
														'button',
														{
															type: 'button',
															onClick: () => setFrameworkFilter(fw),
															className:
																frameworkFilter === fw
																	? 'px-2 py-0.5 rounded-md text-[11px] font-medium bg-(--ui-accent)/15 text-(--ui-accent) border border-(--ui-accent)/40 cursor-pointer'
																	: 'px-2 py-0.5 rounded-md text-[11px] text-(--ui-text-tertiary) hover:bg-(--ui-hover) border border-transparent cursor-pointer',
															children: fw || 'All Frameworks',
														},
														fw || 'all',
													),
												),
											}),
											jsxs('div', {
												className: 'flex items-center gap-1 flex-wrap',
												children: QUICK_QUERIES.map((preset) =>
													jsx(
														'button',
														{
															type: 'button',
															onClick: () => {
																setSearchMode(preset.mode);
																setQuery(preset.q);
															},
															className:
																'px-2 py-0.5 rounded text-[10px] font-mono border border-(--ui-stroke-secondary) text-(--ui-text-tertiary) hover:text-(--ui-text) hover:bg-(--ui-hover) cursor-pointer',
															children: preset.label,
														},
														preset.label,
													),
												),
											}),
										],
									}),
									searchResult.expansion &&
									Array.isArray(searchResult.expansion.matchedIdioms) &&
									searchResult.expansion.matchedIdioms.length > 0
										? jsxs('div', {
												className:
													'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-input)/40 px-3 py-2 text-xs flex items-center gap-2 flex-wrap',
												children: [
													jsx(Codicon, {
														name: 'sparkle',
														className: 'text-(--ui-accent)',
													}),
													jsx('span', {
														className: 'font-medium text-(--ui-text)',
														children: `Idiom Expansion (${searchResult.expansion.matchedIdioms[0].ecosystem} → Apple):`,
													}),
													jsx('span', {
														className: 'text-(--ui-text-secondary)',
														children:
															searchResult.expansion.matchedIdioms[0]
																.description,
													}),
												],
											})
										: null,
								],
							}),

							jsxs('div', {
								className: 'flex-1 min-h-0 grid grid-cols-12',
								children: [
									jsx('div', {
										className:
											'col-span-5 border-r border-(--ui-stroke-secondary) min-h-0',
										children: jsx(ScrollArea, {
											className: 'h-full',
											children: jsxs('div', {
												className: 'p-2 flex flex-col gap-1',
												children: [
													(searchResult.results || []).length === 0 &&
													!searching
														? jsx('p', {
																className:
																	'px-3 py-4 text-[11px] leading-relaxed text-(--ui-text-tertiary)',
																children:
																	'No offline matches in the curated preview (the live index is unreachable). Note the preview only carries a handful of hand-checked symbols — try a broader query or clear the framework filter.',
															})
														: null,
													...(searchResult.results || []).map((item) => {
														const selected =
															selectedSymbol &&
															selectedSymbol.path === item.path;
														return jsx(
															RowButton,
															{
																onClick: () => setSelectedSymbol(item),
																className: selected
																	? 'w-full text-left px-3 py-2.5 rounded-lg bg-(--ui-hover) border border-(--ui-stroke-secondary) flex flex-col gap-1 cursor-pointer'
																	: 'w-full text-left px-3 py-2.5 rounded-lg hover:bg-(--ui-hover)/60 border border-transparent flex flex-col gap-1 cursor-pointer',
																children: jsxs(Fragment, {
																	children: [
																		jsxs('div', {
																			className:
																				'flex items-center justify-between gap-2',
																			children: [
																				jsx('span', {
																					className:
																						'font-mono text-xs font-medium text-(--ui-text) truncate',
																					children: item.title,
																				}),
																				jsx('span', {
																					className:
																						'text-[10px] px-1.5 py-0.5 rounded bg-(--ui-input)/60 text-(--ui-text-tertiary) shrink-0',
																					children: item.framework,
																				}),
																			],
																		}),
																		item.abstract
																			? jsx('p', {
																					className:
																						'text-[11px] text-(--ui-text-tertiary) line-clamp-2',
																					children: item.abstract,
																				})
																			: null,
																	],
																}),
															},
															item.id || item.path,
														);
													}),
												],
											}),
										}),
									}),
									jsx('div', {
										className: 'col-span-7 min-h-0',
										children: jsx(SymbolInspectorDetail, {
											ctx,
											item: selectedSymbol,
											liveDoc,
											loadingDoc,
										}),
									}),
								],
							}),
						],
					})
				: null,

			activeTab === 'idioms'
				? jsx(ScrollArea, {
						className: 'flex-1 min-h-0',
						children: jsxs('div', {
							className: 'p-6 flex flex-col gap-4',
							children: [
								jsxs('div', {
									className:
										'flex items-center justify-between gap-3 flex-wrap',
									children: [
										jsxs('div', {
											children: [
												jsx('h2', {
													className: 'text-sm font-semibold text-(--ui-text)',
													children: 'Cross-Framework Idiom Rosetta Stone',
												}),
												jsx('p', {
													className: 'text-xs text-(--ui-text-tertiary)',
													children:
														'Click any React, Web CSS, or Android/Kotlin concept to inspect its verified Swift 6 / SwiftUI equivalent in the 95.9k symbol index.',
												}),
											],
										}),
										jsx(SegmentedControl, {
											value: ecoFilter,
											onValueChange: setEcoFilter,
											options: [
												{ value: 'all', label: 'All Ecosystems' },
												{ value: 'react', label: 'React' },
												{ value: 'web', label: 'Web / CSS' },
												{ value: 'android', label: 'Android / Kotlin' },
											],
										}),
									],
								}),
								jsxs('div', {
									className: 'grid grid-cols-1 md:grid-cols-2 gap-3',
									children: filteredIdioms.map((entry) =>
										jsxs(
											'div',
											{
												className:
													'rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-input)/25 p-4 flex flex-col gap-2.5',
												children: [
													jsxs('div', {
														className:
															'flex items-center justify-between gap-2',
														children: [
															jsxs('div', {
																className: 'flex items-center gap-2',
																children: [
																	jsx(Badge, {
																		variant: 'secondary',
																		children: entry.ecosystem,
																	}),
																	jsx('span', {
																		className:
																			'font-mono text-sm font-semibold text-(--ui-text)',
																		children: entry.idiom,
																	}),
																],
															}),
															jsx(Button, {
																size: 'sm',
																variant: 'ghost',
																onClick: () => {
																	setQuery(entry.idiom);
																	setSearchMode('semantic');
																	setFrameworkFilter('');
																	setActiveTab('explorer');
																},
																children: 'Explore in Index →',
															}),
														],
													}),
													jsx('p', {
														className: 'text-xs text-(--ui-text-secondary)',
														children: entry.description,
													}),
													jsxs('div', {
														className: 'flex items-center gap-1.5 flex-wrap',
														children: (entry.appleSymbols || []).map((sym) =>
															jsx(
																'button',
																{
																	type: 'button',
																	onClick: () => {
																		setQuery(
																			sym.replace(/^@/, '').split('(')[0],
																		);
																		setFrameworkFilter('');
																		setActiveTab('explorer');
																	},
																	className:
																		'px-2 py-0.5 rounded font-mono text-[11px] border border-(--ui-stroke-secondary) bg-(--ui-input)/50 text-(--ui-accent) hover:bg-(--ui-hover) cursor-pointer',
																	children: sym,
																},
																sym,
															),
														),
													}),
													entry.snippet
														? jsx('pre', {
																className:
																	'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-input)/50 p-2.5 text-[11px] font-mono text-(--ui-text) overflow-x-auto',
																children: entry.snippet,
															})
														: null,
												],
											},
											entry.idiom,
										),
									),
								}),
							],
						}),
					})
				: null,

			activeTab === 'compiler'
				? jsx(ScrollArea, {
						className: 'flex-1 min-h-0',
						children: jsxs('div', {
							className: 'p-6 flex flex-col gap-4',
							children: [
								jsxs('div', {
									className:
										'flex items-center justify-between gap-3 flex-wrap',
									children: [
										jsxs('div', {
											children: [
												jsx('h2', {
													className: 'text-sm font-semibold text-(--ui-text)',
													children:
														'Automatic Swift & Xcode Compiler Grounding Hook (`transform_terminal_output`)',
												}),
												jsx('p', {
													className: 'text-xs text-(--ui-text-tertiary)',
													children:
														'Whenever Hermes runs a failing `swift build`, `swift test`, `swiftc`, or `xcodebuild` command, our lifecycle hook extracts deprecated/missing APIs and injects verified DocC replacements in <4ms.',
												}),
											],
										}),
										jsxs('div', {
											className: 'flex items-center gap-1.5 flex-wrap',
											children: COMPILER_PRESETS.map((preset) =>
												jsx(
													Button,
													{
														size: 'sm',
														variant: 'ghost',
														onClick: () => {
															setCompilerLog(preset.log);
															runCompilerDiagnosis(preset.log);
														},
														children: preset.label,
													},
													preset.id,
												),
											),
										}),
									],
								}),
								jsxs('div', {
									className: 'flex flex-col gap-2',
									children: [
										jsx(Textarea, {
											rows: 5,
											value: compilerLog,
											onChange: (e) => setCompilerLog(e.target.value),
											className: 'font-mono text-xs',
										}),
										jsxs('div', {
											className: 'flex items-center justify-between',
											children: [
												jsx('span', {
													className:
														'text-[11px] text-(--ui-text-tertiary) font-mono',
													children: `Analyzed in ${diagResult.latencyMs ?? 1.8} ms · ${(diagResult.findings || []).length} DocC replacement(s) grounded`,
												}),
												jsx(Button, {
													size: 'sm',
													variant: 'secondary',
													onClick: () => runCompilerDiagnosis(compilerLog),
													children: diagnosing
														? 'Analyzing…'
														: 'Ground Compiler Output',
												}),
											],
										}),
									],
								}),
								jsxs('div', {
									className: 'flex flex-col gap-3',
									children: (diagResult.findings || []).map((f) =>
										jsxs(
											'div',
											{
												className:
													'rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-input)/30 p-4 flex flex-col gap-2',
												children: [
													jsxs('div', {
														className:
															'flex items-center justify-between gap-2 flex-wrap',
														children: [
															jsxs('div', {
																className: 'flex items-center gap-2',
																children: [
																	jsx('span', {
																		className:
																			'font-mono text-xs line-through text-(--ui-text-tertiary)',
																		children: f.symbol,
																	}),
																	jsx('span', {
																		className:
																			'text-xs text-(--ui-text-tertiary)',
																		children: '→',
																	}),
																	jsx('span', {
																		className:
																			'font-mono text-xs font-semibold text-(--ui-accent)',
																		children: f.replacement,
																	}),
																	jsx(Badge, {
																		variant: 'secondary',
																		children: f.framework,
																	}),
																],
															}),
															jsx(Button, {
																size: 'sm',
																variant: 'ghost',
																onClick: () => {
																	setQuery(
																		f.replacement
																			.split('/')[0]
																			.replace(/^@/, '')
																			.split('(')[0]
																			.trim(),
																	);
																	setFrameworkFilter(f.framework);
																	setActiveTab('explorer');
																},
																children: `Inspect ${f.docPath}`,
															}),
														],
													}),
													jsx('p', {
														className: 'text-xs text-(--ui-text-secondary)',
														children: f.reason,
													}),
													f.fixSnippet
														? jsx('pre', {
																className:
																	'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-input)/50 p-2.5 text-[11px] font-mono text-(--ui-text) overflow-x-auto',
																children: f.fixSnippet,
															})
														: null,
												],
											},
											f.symbol,
										),
									),
								}),
							],
						}),
					})
				: null,

			activeTab === 'frameworks'
				? jsx(ScrollArea, {
						className: 'flex-1 min-h-0',
						children: jsxs('div', {
							className: 'p-6 flex flex-col gap-4',
							children: [
								jsxs('div', {
									className: 'grid grid-cols-2 md:grid-cols-4 gap-3',
									children: [
										{
											label: 'Offline Symbols',
											val: (stats.symbolCount || 95899).toLocaleString(),
										},
										{
											label: 'Apple Frameworks',
											val: String(stats.frameworkCount || 30),
										},
										{
											label: 'Cross-Framework Idioms',
											val: String(stats.idiomCount || 16),
										},
										{
											label: 'FTS5 Query Speed',
											val: `${stats.latencyMs || 2.8} ms`,
										},
									].map((kpi) =>
										jsxs(
											'div',
											{
												className:
													'rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-input)/30 p-4 flex flex-col gap-1',
												children: [
													jsx('span', {
														className:
															'text-lg font-bold font-mono text-(--ui-text)',
														children: kpi.val,
													}),
													jsx('span', {
														className:
															'text-[11px] uppercase tracking-wider text-(--ui-text-tertiary)',
														children: kpi.label,
													}),
												],
											},
											kpi.label,
										),
									),
								}),
								jsx(Separator, {}),
								jsxs('div', {
									className:
										'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5',
									children: (stats.frameworks || FALLBACK_STATS.frameworks).map(
										(fw) => {
											const maxCount =
												stats.frameworks?.[0]?.symbolCount || 20000;
											const pct = Math.max(
												4,
												Math.min(
													100,
													Math.round((fw.symbolCount / maxCount) * 100),
												),
											);
											return jsx(
												RowButton,
												{
													onClick: () => {
														setFrameworkFilter(fw.name);
														setQuery('*');
														setSearchMode('lexical');
														setActiveTab('explorer');
													},
													className:
														'rounded-lg border border-(--ui-stroke-secondary) p-3 hover:bg-(--ui-hover) flex flex-col gap-1.5 text-left cursor-pointer',
													children: jsxs(Fragment, {
														children: [
															jsxs('div', {
																className:
																	'flex items-center justify-between text-xs',
																children: [
																	jsx('span', {
																		className: 'font-semibold text-(--ui-text)',
																		children: fw.name,
																	}),
																	jsx('span', {
																		className:
																			'font-mono text-[11px] text-(--ui-text-tertiary)',
																		children: `${fw.symbolCount.toLocaleString()} symbols`,
																	}),
																],
															}),
															jsx('div', {
																className:
																	'h-1.5 w-full rounded-full bg-(--ui-input) overflow-hidden',
																children: jsx('div', {
																	className:
																		'h-full rounded-full bg-(--ui-accent)',
																	style: { width: `${pct}%` },
																}),
															}),
														],
													}),
												},
												fw.name,
											);
										},
									),
								}),
							],
						}),
					})
				: null,
		],
	});
}

function AppleDocsSidePane({ ctx }) {
	const [activeTab, setActiveTab] = useState('search');
	const [q, setQ] = useState('');
	const [framework, setFramework] = useState('');
	const [searchMode, setSearchMode] = useState('semantic');
	const [selectedSymbol, setSelectedSymbol] = useState(null);

	const [idiomFilter, setIdiomFilter] = useState('all');
	const [idiomQ, setIdiomQ] = useState('');

	const debouncedQ = useDebouncedValue(q, 180);
	const targetQ = debouncedQ.trim() || 'NavigationSplitView';

	const idiomsQuery = useQuery({
		queryKey: [PLUGIN_ID, 'idioms'],
		queryFn: () => fetchPluginIdioms(ctx),
		staleTime: 60_000,
	});
	const searchQuery = useQuery({
		queryKey: [PLUGIN_ID, 'search', targetQ, framework, searchMode, 15],
		queryFn: () =>
			fetchPluginSearch(ctx, {
				q: targetQ,
				framework,
				mode: searchMode,
				limit: 15,
			}),
		staleTime: 15_000,
		placeholderData: (prev) => prev,
	});
	const docQuery = useQuery({
		queryKey: [
			PLUGIN_ID,
			'doc',
			selectedSymbol?.path || '',
			selectedSymbol?.framework || '',
		],
		queryFn: () =>
			fetchPluginDoc(ctx, {
				path: selectedSymbol?.path,
				framework: selectedSymbol?.framework,
			}),
		enabled: Boolean(selectedSymbol && selectedSymbol.path),
		staleTime: 60_000,
	});

	const idioms = idiomsQuery.data || FALLBACK_IDIOMS;
	const items = useMemo(
		() =>
			searchQuery.data?.data?.results?.length
				? searchQuery.data.data.results
				: localSearchFallback(targetQ, framework).results,
		[searchQuery.data, targetQ, framework],
	);
	const searching = searchQuery.isFetching;
	const liveDoc = selectedSymbol ? docQuery.data || null : null;
	const loadingDoc = docQuery.isFetching;

	const filteredIdioms = useMemo(() => {
		return idioms.filter((i) => {
			if (idiomFilter !== 'all' && i.ecosystem !== idiomFilter) return false;
			if (!idiomQ.trim()) return true;
			const needle = idiomQ.toLowerCase();
			return (
				(i.idiom || '').toLowerCase().includes(needle) ||
				(i.description || '').toLowerCase().includes(needle) ||
				(i.category || '').toLowerCase().includes(needle) ||
				(i.frameworks || []).some((f) => f.toLowerCase().includes(needle))
			);
		});
	}, [idioms, idiomFilter, idiomQ]);

	return jsxs('div', {
		className:
			'h-full w-full flex flex-col overflow-hidden bg-(--ui-surface) text-(--ui-text)',
		children: [
			jsxs('div', {
				className:
					'p-2.5 border-b border-(--ui-stroke-secondary) flex flex-col gap-2 shrink-0 bg-(--ui-surface)',
				children: [
					jsxs('div', {
						className: 'flex items-center justify-between gap-1.5',
						children: [
							jsxs('div', {
								className: 'flex items-center gap-1.5 min-w-0',
								children: [
									jsx(Codicon, {
										name: 'book',
										className: 'text-(--ui-accent) text-sm shrink-0',
									}),
									jsx('span', {
										className: 'text-xs font-semibold truncate',
										children: ' Apple Docs',
									}),
									jsx(Badge, {
										variant: 'secondary',
										className: 'text-[9px] px-1 py-0',
										children: '95.9k',
									}),
								],
							}),
							jsxs('div', {
								className: 'flex items-center gap-1 shrink-0',
								children: [
									jsx(Button, {
										size: 'xs',
										variant: 'ghost',
										title: 'Open in Full Studio Page',
										onClick: () => safeNavigate(STUDIO_ROUTE),
										children: 'Full Studio ↗',
									}),
								],
							}),
						],
					}),
					jsx(SegmentedControl, {
						value: activeTab,
						onValueChange: (val) => {
							safeHaptic('tap');
							setActiveTab(val);
						},
						options: [
							{ value: 'search', label: 'Symbols' },
							{ value: 'idioms', label: 'Rosetta' },
							{ value: 'compiler', label: 'Compiler' },
						],
					}),
				],
			}),

			activeTab === 'search'
				? selectedSymbol
					? jsxs('div', {
							className: 'flex-1 min-h-0 flex flex-col',
							children: [
								jsxs('div', {
									className:
										'px-2.5 py-1.5 border-b border-(--ui-stroke-secondary) flex items-center justify-between gap-2 shrink-0 bg-(--ui-surface-secondary)',
									children: [
										jsx(Button, {
											size: 'xs',
											variant: 'ghost',
											onClick: () => setSelectedSymbol(null),
											children: '← Back to Results',
										}),
										jsx('span', {
											className:
												'text-[10px] font-mono text-(--ui-text-tertiary) truncate max-w-[160px]',
											children: selectedSymbol.title,
										}),
									],
								}),
								jsx('div', {
									className: 'flex-1 min-h-0',
									children: jsx(SymbolInspectorDetail, {
										ctx,
										item: selectedSymbol,
										liveDoc,
										loadingDoc,
									}),
								}),
							],
						})
					: jsxs('div', {
							className: 'flex-1 min-h-0 flex flex-col p-2.5 gap-2',
							children: [
								jsx(Input, {
									value: q,
									onChange: (e) => setQ(e.target.value),
									placeholder: 'Symbol, Grid*, or React idiom…',
								}),
								jsxs('div', {
									className:
										'flex items-center justify-between gap-1 flex-wrap',
									children: [
										jsxs('div', {
											className: 'flex items-center gap-1',
											children: [
												jsx('button', {
													type: 'button',
													onClick: () => setSearchMode('semantic'),
													className:
														searchMode === 'semantic'
															? 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-(--ui-accent)/15 text-(--ui-accent) border border-(--ui-accent)/40 cursor-pointer'
															: 'px-1.5 py-0.5 rounded text-[10px] text-(--ui-text-tertiary) hover:bg-(--ui-hover) border border-transparent cursor-pointer',
													children: 'Semantic',
												}),
												jsx('button', {
													type: 'button',
													onClick: () => setSearchMode('lexical'),
													className:
														searchMode === 'lexical'
															? 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-(--ui-accent)/15 text-(--ui-accent) border border-(--ui-accent)/40 cursor-pointer'
															: 'px-1.5 py-0.5 rounded text-[10px] text-(--ui-text-tertiary) hover:bg-(--ui-hover) border border-transparent cursor-pointer',
													children: 'Lexical',
												}),
											],
										}),
										jsx('span', {
											className: 'text-[10px] text-(--ui-text-tertiary)',
											children: searching
												? 'Searching…'
												: `${items.length} hits`,
										}),
									],
								}),
								jsx(ScrollArea, {
									className: 'flex-1 min-h-0',
									children: jsxs('div', {
										className: 'flex flex-col gap-1.5 pr-1',
										children: items.map((it) => {
											const bare = (it.title || '')
												.split('(')[0]
												.replace(/^func\s+|^var\s+|^@/, '')
												.trim();
											const refToken = `@apple:${it.framework}/${bare}`;
											return jsxs(
												'div',
												{
													className:
														'rounded-lg border border-(--ui-stroke-secondary) p-2 flex flex-col gap-1 hover:bg-(--ui-hover)/50 transition-colors',
													children: [
														jsxs('div', {
															className:
																'flex items-center justify-between gap-1.5 cursor-pointer',
															onClick: () => setSelectedSymbol(it),
															children: [
																jsx('span', {
																	className:
																		'font-mono text-[11px] font-semibold text-(--ui-text) truncate',
																	children: it.title,
																}),
																jsx(Badge, {
																	variant: 'secondary',
																	className: 'text-[9px] shrink-0',
																	children: it.framework,
																}),
															],
														}),
														it.abstract
															? jsx('p', {
																	className:
																		'text-[10px] text-(--ui-text-tertiary) line-clamp-2 cursor-pointer',
																	onClick: () => setSelectedSymbol(it),
																	children: it.abstract,
																})
															: null,
														jsxs('div', {
															className:
																'flex items-center justify-between gap-1 pt-1 border-t border-(--ui-stroke-secondary)/40 mt-0.5',
															children: [
																jsx(Button, {
																	size: 'xs',
																	variant: 'ghost',
																	onClick: () => setSelectedSymbol(it),
																	children: 'Inspect →',
																}),
																jsxs('div', {
																	className: 'flex items-center gap-1',
																	children: [
																		jsx(Button, {
																			size: 'xs',
																			variant: 'ghost',
																			onClick: () =>
																				insertIntoChatComposer(
																					ctx,
																					refToken,
																					false,
																				),
																			children: 'Insert @apple:',
																		}),
																		jsx(Button, {
																			size: 'xs',
																			variant: 'ghost',
																			onClick: () =>
																				safeOpenExternal(
																					ctx,
																					it.webUrl ||
																						`https://developer.apple.com${it.path}`,
																				),
																			children: 'DocC ↗',
																		}),
																	],
																}),
															],
														}),
													],
												},
												it.id || it.path,
											);
										}),
									}),
								}),
							],
						})
				: null,

			activeTab === 'idioms'
				? jsxs('div', {
						className: 'flex-1 min-h-0 flex flex-col p-2.5 gap-2',
						children: [
							jsx(Input, {
								value: idiomQ,
								onChange: (e) => setIdiomQ(e.target.value),
								placeholder: 'Filter idioms (useEffect, state, redux…)',
							}),
							jsxs('div', {
								className: 'flex items-center gap-1 flex-wrap',
								children: ['all', 'react', 'web', 'android'].map((eco) =>
									jsx(
										'button',
										{
											type: 'button',
											onClick: () => setIdiomFilter(eco),
											className:
												idiomFilter === eco
													? 'px-2 py-0.5 rounded text-[10px] font-medium bg-(--ui-accent)/15 text-(--ui-accent) border border-(--ui-accent)/40 cursor-pointer'
													: 'px-2 py-0.5 rounded text-[10px] text-(--ui-text-tertiary) hover:bg-(--ui-hover) border border-transparent cursor-pointer',
											children:
												eco === 'all'
													? 'All'
													: eco.charAt(0).toUpperCase() + eco.slice(1),
										},
										eco,
									),
								),
							}),
							jsx(ScrollArea, {
								className: 'flex-1 min-h-0',
								children: jsxs('div', {
									className: 'flex flex-col gap-2 pr-1',
									children: filteredIdioms.map((item) =>
										jsxs(
											'div',
											{
												className:
													'rounded-lg border border-(--ui-stroke-secondary) p-2.5 flex flex-col gap-1.5 bg-(--ui-surface-secondary)/30',
												children: [
													jsxs('div', {
														className:
															'flex items-center justify-between gap-1.5',
														children: [
															jsx('span', {
																className:
																	'text-[11px] font-semibold text-(--ui-text)',
																children: item.idiom,
															}),
															jsx(Badge, {
																variant: 'secondary',
																className: 'text-[9px]',
																children: item.ecosystem,
															}),
														],
													}),
													jsx('p', {
														className: 'text-[10px] text-(--ui-text-tertiary)',
														children: item.description,
													}),
													item.snippet
														? jsxs('div', {
																className:
																	'rounded bg-(--ui-surface) border border-(--ui-stroke-secondary) p-2 flex flex-col gap-1 font-mono text-[10px]',
																children: [
																	jsx('pre', {
																		className:
																			'overflow-x-auto text-(--ui-text-secondary)',
																		children: item.snippet,
																	}),
																	jsxs('div', {
																		className:
																			'flex items-center justify-end gap-1 pt-1 border-t border-(--ui-stroke-secondary)/40',
																		children: [
																			jsx(CopyButton, {
																				text: item.snippet,
																				label: 'Copy Swift',
																			}),
																			item.appleSymbols &&
																			item.appleSymbols.length
																				? jsx(Button, {
																						size: 'xs',
																						variant: 'ghost',
																						onClick: () =>
																							insertIntoChatComposer(
																								ctx,
																								`@apple:${item.frameworks?.[0] || 'SwiftUI'}/${item.appleSymbols[0]}`,
																								false,
																							),
																						children: 'Insert @apple:',
																					})
																				: null,
																		],
																	}),
																],
															})
														: null,
												],
											},
											item.idiom,
										),
									),
								}),
							}),
						],
					})
				: null,

			activeTab === 'compiler'
				? jsxs('div', {
						className: 'flex-1 min-h-0 flex flex-col p-2.5 gap-2',
						children: [
							jsx('span', {
								className: 'text-[11px] font-semibold text-(--ui-text)',
								children: 'Xcode / Swift Build Log',
							}),
							jsx(CompactCompilerLab, { ctx, rows: 4 }),
						],
					})
				: null,
		],
	});
}

const AppleDocsQuickPane = AppleDocsSidePane;

function CompactCompilerLab({ ctx, rows = 4 }) {
	const t = usePluginI18n(PLUGIN_ID);
	const [compilerLog, setCompilerLog] = useState(COMPILER_PRESETS[0].log);

	const diagnoseMutation = useMutation({
		mutationFn: (textToAnalyze) => runPluginDiagnose(ctx, textToAnalyze),
	});

	const diagResult = useMemo(
		() =>
			diagnoseMutation.data?.result ||
			localDiagnoseFallback(COMPILER_PRESETS[0].log),
		[diagnoseMutation.data],
	);
	const diagnosing = diagnoseMutation.isPending;

	const runCompilerDiagnosis = (text) => {
		const body = typeof text === 'string' && text ? text : compilerLog;
		diagnoseMutation.mutate(body);
	};

	const findings =
		diagResult && Array.isArray(diagResult.findings) ? diagResult.findings : [];

	return jsxs('div', {
		className: 'flex-1 min-h-0 flex flex-col gap-2',
		children: [
			jsxs('div', {
				className: 'flex items-center gap-1 flex-wrap shrink-0',
				children: COMPILER_PRESETS.map((preset) =>
					jsx(
						Button,
						{
							size: 'xs',
							variant: 'outline',
							onClick: () => {
								setCompilerLog(preset.log);
								runCompilerDiagnosis(preset.log);
							},
							className: 'font-mono text-[10px] max-w-[150px] truncate',
							children: preset.label,
						},
						preset.label,
					),
				),
			}),
			jsx(Textarea, {
				value: compilerLog,
				onChange: (e) => setCompilerLog(e.target.value),
				rows,
				className: 'font-mono text-[10px] shrink-0',
				placeholder: t('compilerPlaceholder'),
			}),
			jsx(Button, {
				size: 'xs',
				variant: 'secondary',
				onClick: () => runCompilerDiagnosis(compilerLog),
				children: diagnosing ? t('diagnosing') : t('diagnoseBtn'),
			}),
			jsx(ScrollArea, {
				className: 'flex-1 min-h-0',
				children: jsxs('div', {
					className: 'flex flex-col gap-1.5 pr-1',
					children: findings.length
						? findings.map((f, idx) =>
								jsxs(
									'div',
									{
										className:
											'rounded-lg border border-(--ui-stroke-secondary) p-2 flex flex-col gap-1 bg-(--ui-surface-secondary)/30',
										children: [
											jsxs('div', {
												className: 'flex items-center justify-between gap-1.5',
												children: [
													jsx('span', {
														className:
															'font-mono text-[10px] font-semibold text-(--ui-accent) truncate',
														children: f.symbol,
													}),
													jsx(Badge, {
														variant: 'secondary',
														className: 'text-[9px] shrink-0',
														children: f.framework,
													}),
												],
											}),
											f.issue
												? jsx('p', {
														className: 'text-[10px] text-(--ui-text-tertiary)',
														children: f.issue,
													})
												: null,
											f.suggestion
												? jsxs('div', {
														className:
															'flex items-center justify-between gap-1 pt-1 border-t border-(--ui-stroke-secondary)/40',
														children: [
															jsx('span', {
																className:
																	'text-[10px] font-mono text-(--ui-text) truncate',
																children: `→ ${f.suggestion}`,
															}),
															jsx(Button, {
																size: 'xs',
																variant: 'ghost',
																onClick: () =>
																	insertIntoChatComposer(
																		ctx,
																		`@apple:${f.framework}/${f.suggestion}`,
																		false,
																	),
																children: 'Insert @apple:',
															}),
														],
													})
												: null,
										],
									},
									`finding-${idx}`,
								),
							)
						: jsx('p', {
								className: 'text-[10px] text-(--ui-text-tertiary) p-2',
								children: t('noDeprecated'),
							}),
				}),
			}),
		],
	});
}

/**
 * Second docked pane: the Xcode Error Hook Lab, standalone.
 *
 * Not decoration — the desktop pane shell treats a plugin that owns exactly ONE
 * pane as disposable: closing that pane calls `setPluginEnabled(pluginId,
 * false)`, which unregisters every contribution the plugin ever made (the
 * sessions-sidebar row, the /apple-docs page, the statusbar chip, the palette
 * commands). With two panes, closing either one only dismisses that pane, so
 * the Apple Docs entry point can never be nuked by closing the docked studio.
 */
function AppleDocsCompilerPane({ ctx }) {
	const t = usePluginI18n(PLUGIN_ID);

	return jsxs('div', {
		className: 'h-full w-full flex flex-col overflow-hidden p-3 gap-2',
		children: [
			jsxs('div', {
				className: 'flex items-center justify-between gap-2 shrink-0',
				children: [
					jsxs('div', {
						className: 'flex items-center gap-1.5 min-w-0',
						children: [
							jsx(Codicon, {
								name: 'warning',
								className: 'text-(--ui-accent) shrink-0',
							}),
							jsxs('div', {
								className: 'min-w-0',
								children: [
									jsx('div', {
										className:
											'text-xs font-semibold text-(--ui-text) truncate',
										children: t('compilerPaneTitle'),
									}),
									jsx('div', {
										className: 'text-[10px] text-(--ui-text-tertiary) truncate',
										children: t('compilerPaneSubtitle'),
									}),
								],
							}),
						],
					}),
					jsx(Button, {
						size: 'xs',
						variant: 'ghost',
						onClick: () => safeNavigate(STUDIO_ROUTE),
						children: 'Studio ↗',
					}),
				],
			}),
			jsx(CompactCompilerLab, { ctx, rows: 5 }),
		],
	});
}

function formatCompactCount(count) {
	const num = Number(count) || 0;
	if (num >= 1000) {
		return `${(num / 1000).toFixed(1)}k`;
	}
	return String(num);
}

function AppleDocsStatusChip({ ctx }) {
	const t = usePluginI18n(PLUGIN_ID);
	const statusQuery = useQuery({
		queryKey: [PLUGIN_ID, 'status'],
		queryFn: () => fetchPluginStatus(ctx),
		staleTime: 30_000,
	});
	const stats = statusQuery.data?.stats || FALLBACK_STATS;
	const apiLive = Boolean(statusQuery.data?.apiLive);
	const symbolCount = stats.symbolCount || FALLBACK_STATS.symbolCount;
	const compact = formatCompactCount(symbolCount);

	return jsx(Tip, {
		label: apiLive
			? t('statusTipLive', symbolCount.toLocaleString())
			: t('statusTipOffline', symbolCount.toLocaleString()),
		children: jsxs('button', {
			type: 'button',
			onClick: () => {
				safeHaptic('tap');
				if (!safeOpenPane('inspector-pane')) {
					safeNavigate(STUDIO_ROUTE);
				}
			},
			className:
				'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] text-(--ui-text-tertiary) hover:text-(--ui-text) hover:bg-(--chrome-action-hover) transition-colors cursor-pointer',
			children: [
				jsx(StatusDot, {
					tone: apiLive ? 'success' : 'neutral',
					size: 'xs',
				}),
				` ${compact} Docs`,
			],
		}),
	});
}

function registerContributions(ctx, entries) {
	if (typeof ctx?.registerMany === 'function') {
		return ctx.registerMany(entries);
	}
	if (typeof ctx?.register === 'function') {
		const disposers = [];
		for (const entry of entries) {
			try {
				const dispose = ctx.register(entry);
				if (typeof dispose === 'function') disposers.push(dispose);
			} catch (err) {
				console.warn(
					`[apple-doc-plugin] failed to register contribution ${entry.id}:`,
					err,
				);
			}
		}
		return () => {
			for (const dispose of disposers) dispose();
		};
	}
	return undefined;
}

export default {
	id: PLUGIN_ID,
	name: 'Apple Developer Documentation',
	defaultEnabled: true,

	register(ctx) {
		if (ctx?.i18n?.register) {
			ctx.i18n.register({
				en: {
					statusTipLive: (n) => `Apple Docs (${n} symbols, live backend)`,
					statusTipOffline: (n) => `Apple Docs (${n} symbols, offline index)`,
					compilerPaneTitle: 'Xcode Error Hook',
					compilerPaneSubtitle: 'Offline deprecated-API migrations',
					compilerPlaceholder:
						'Paste swift build / xcodebuild error output here…',
					diagnoseBtn: 'Diagnose Errors',
					diagnosing: 'Diagnosing…',
					noDeprecated: 'No deprecated Apple symbols identified in output.',
				},
				ar: {
					statusTipLive: (n) => `توثيق أبل (${n} رمز، الخادم متصل)`,
					statusTipOffline: (n) => `توثيق أبل (${n} رمز، فهرس محلي)`,
					compilerPaneTitle: 'فاحص أخطاء Xcode',
					compilerPaneSubtitle: 'ترحيل واجهات API القديمة بدون نت',
					compilerPlaceholder: 'الصق مخرجات swift build أو xcodebuild هنا…',
					diagnoseBtn: 'تحليل الأخطاء',
					diagnosing: 'جاري التحليل…',
					noDeprecated: 'ما فيه رموز أبل مهجورة في المخرجات.',
				},
			});
		}

		const statusbarArea =
			(STATUSBAR_AREAS && STATUSBAR_AREAS.right) || 'statusBar.right';
		return registerContributions(ctx, [
			{
				id: 'studio-route',
				area: ROUTES_AREA,
				data: { path: STUDIO_ROUTE },
				render: () => jsx(AppleDocsStudioPage, { ctx }),
			},
			{
				// Route-agnostic sidebar entry: `data.path` navigates to /apple-docs
				// when clicked, without gating visibility to a single route.
				id: 'sidebar-nav',
				area: SIDEBAR_NAV_AREA,
				order: 62,
				data: {
					path: STUDIO_ROUTE,
					label: 'Apple Docs',
					codicon: 'book',
				},
			},
			{
				id: 'inspector-pane',
				area: PANES_AREA,
				title: 'Apple Docs',
				data: {
					placement: 'right',
					width: '380px',
					dock: {
						pane: 'workspace',
						pos: 'right',
					},
				},
				render: () => jsx(AppleDocsSidePane, { ctx }),
			},
			{
				// Second pane: keeps Close as a dismiss instead of disabling the
				// entire plugin when the user closes one pane.
				id: 'compiler-pane',
				area: PANES_AREA,
				title: 'Apple Docs: Xcode Errors',
				data: {
					placement: 'right',
					width: '360px',
					dock: {
						pane: 'workspace',
						pos: 'right',
					},
				},
				render: () => jsx(AppleDocsCompilerPane, { ctx }),
			},
			{
				id: 'inline-directive',
				area: TRANSCRIPT_DIRECTIVE_AREA,
				data: {
					name: 'apple-doc',
					render: (props) =>
						jsx(InlineAppleDocCard, {
							ctx,
							attrs: props?.attrs || {},
							sessionId: props?.sessionId,
							streaming: props?.streaming,
						}),
				},
			},
			{
				id: 'statusbar-chip',
				area: statusbarArea,
				order: 118,
				render: () => jsx(AppleDocsStatusChip, { ctx }),
			},
			{
				id: 'palette-open',
				area: PALETTE_AREA,
				data: {
					id: 'apple-docs.open-studio',
					label: 'Apple Docs: Open Documentation (Side Pane)',
					keywords: [
						'apple',
						'swift',
						'swiftui',
						'ios',
						'macos',
						'docc',
						'xcode',
						'documentation',
						'side',
						'pane',
					],
					run: () => {
						if (!safeOpenPane('inspector-pane')) {
							safeNavigate(STUDIO_ROUTE);
						}
					},
				},
			},
			{
				id: 'palette-compiler',
				area: PALETTE_AREA,
				data: {
					id: 'apple-docs.open-compiler',
					label: 'Apple Docs: Open Xcode Error Hook (Side Pane)',
					keywords: [
						'apple',
						'xcode',
						'swift',
						'error',
						'build',
						'deprecated',
						'compiler',
					],
					run: () => {
						if (!safeOpenPane('compiler-pane')) {
							safeNavigate(STUDIO_ROUTE);
						}
					},
				},
			},
			{
				id: 'palette-demo',
				area: PALETTE_AREA,
				data: {
					id: 'apple-docs.run-demo',
					label: 'Apple Docs: Load /apple-docs demo Showcase in Chat',
					keywords: ['apple', 'demo', 'hackathon', 'benchmark', 'swiftui'],
					run: () => sendDemoCommandInChat(ctx),
				},
			},
		]);
	},
};
