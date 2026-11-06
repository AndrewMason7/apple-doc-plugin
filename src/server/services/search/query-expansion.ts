/**
 * Cross-Framework Query Expansion Layer
 *
 * Maps web (React, CSS, HTML), Android (Jetpack, Kotlin), and general front-end
 * idioms (e.g. `useEffect`, `SharedPreferences`, `Flexbox`, `coroutine`, `async storage`)
 * into native Apple symbols (`task`, `onAppear`, `AppStorage`, `VStack`, `Spacer`)
 * within hybrid search to ensure high recall across all embedding models.
 */

export interface IdiomDefinition {
	/** Canonical idiom name (e.g. "useEffect") */
	idiom: string;
	/** Platform/ecosystem source (e.g. "react", "android", "web") */
	ecosystem: 'react' | 'android' | 'web' | 'general';
	/** Category of functionality */
	category:
		| 'lifecycle'
		| 'state'
		| 'storage'
		| 'layout'
		| 'concurrency'
		| 'ui'
		| 'networking'
		| 'navigation';
	/** Target Apple symbols/modifiers/types (e.g. ["task", "onAppear", "onChange"]) */
	appleSymbols: string[];
	/** Suggested frameworks */
	frameworks: string[];
	/** Short human-readable explanation */
	description: string;
	/** Synonyms or alternate spellings to match */
	aliases?: string[];
}

export const CROSS_FRAMEWORK_IDIOMS: IdiomDefinition[] = [
	// 1. Lifecycle & Side Effects
	{
		idiom: 'useEffect',
		ecosystem: 'react',
		category: 'lifecycle',
		appleSymbols: ['task', 'onAppear', 'onChange', 'onDisappear', 'Task'],
		frameworks: ['SwiftUI', '_Concurrency'],
		description:
			'SwiftUI equivalents for asynchronous side effects, mount triggers, and state observation',
		aliases: [
			'use_effect',
			'useeffect',
			'componentDidMount',
			'componentDidUpdate',
		],
	},
	{
		idiom: 'useLayoutEffect',
		ecosystem: 'react',
		category: 'lifecycle',
		appleSymbols: ['onAppear', 'task', 'GeometryReader'],
		frameworks: ['SwiftUI'],
		description: 'Synchronous layout effect before view render',
		aliases: ['use_layout_effect', 'uselayouteffect'],
	},
	{
		idiom: 'onDestroy',
		ecosystem: 'android',
		category: 'lifecycle',
		appleSymbols: ['onDisappear', 'deinit'],
		frameworks: ['SwiftUI'],
		description: 'View or component teardown lifecycle event',
		aliases: ['on_destroy', 'ondestroy', 'componentWillUnmount'],
	},
	{
		idiom: 'onResume',
		ecosystem: 'android',
		category: 'lifecycle',
		appleSymbols: ['onAppear', 'scenePhase', 'ScenePhase'],
		frameworks: ['SwiftUI'],
		description: 'Android onResume activity/app foreground lifecycle event',
		aliases: ['on_resume', 'onresume', 'onStart', 'on_start'],
	},
	{
		idiom: 'onPause',
		ecosystem: 'android',
		category: 'lifecycle',
		appleSymbols: ['scenePhase', 'ScenePhase', 'onDisappear'],
		frameworks: ['SwiftUI'],
		description: 'Android onPause/onStop background lifecycle event',
		aliases: ['on_pause', 'onpause', 'onStop', 'on_stop'],
	},

	// 2. State & Data Binding
	{
		idiom: 'useState',
		ecosystem: 'react',
		category: 'state',
		appleSymbols: ['State', '@State', 'Binding', '@Binding'],
		frameworks: ['SwiftUI'],
		description: 'SwiftUI mutable local view state',
		aliases: ['use_state', 'usestate'],
	},
	{
		idiom: 'useContext',
		ecosystem: 'react',
		category: 'state',
		appleSymbols: [
			'Environment',
			'@Environment',
			'EnvironmentObject',
			'@EnvironmentObject',
			'EnvironmentValues',
		],
		frameworks: ['SwiftUI'],
		description: 'SwiftUI dependency injection via environment',
		aliases: ['use_context', 'usecontext'],
	},
	{
		idiom: 'useMemo',
		ecosystem: 'react',
		category: 'state',
		appleSymbols: ['State', 'computed property', 'Equatable'],
		frameworks: ['SwiftUI'],
		description: 'Memoization and computed properties in SwiftUI',
		aliases: ['use_memo', 'usememo', 'useCallback', 'use_callback'],
	},
	{
		idiom: 'Redux',
		ecosystem: 'react',
		category: 'state',
		appleSymbols: [
			'Observable',
			'@Observable',
			'ObservableObject',
			'@Published',
			'Observation',
		],
		frameworks: ['SwiftUI', 'Observation', 'Combine'],
		description:
			'Centralized state management with Observation or ObservableObject',
		aliases: ['zustand', 'mobx', 'vuex', 'pinia'],
	},
	{
		idiom: 'LiveData',
		ecosystem: 'android',
		category: 'state',
		appleSymbols: [
			'Observable',
			'@Observable',
			'Published',
			'@Published',
			'CurrentValueSubject',
			'AsyncStream',
		],
		frameworks: ['Observation', 'Combine', '_Concurrency'],
		description: 'Observable observable state stream',
		aliases: ['StateFlow', 'SharedFlow'],
	},
	{
		idiom: 'ViewModel',
		ecosystem: 'android',
		category: 'state',
		appleSymbols: ['Observable', '@Observable', 'ObservableObject'],
		frameworks: ['Observation', 'SwiftUI'],
		description: 'View-model architecture pattern for SwiftUI views',
		aliases: ['view_model', 'viewmodel'],
	},

	// 3. Storage & Persistence
	{
		idiom: 'SharedPreferences',
		ecosystem: 'android',
		category: 'storage',
		appleSymbols: ['AppStorage', '@AppStorage', 'UserDefaults'],
		frameworks: ['SwiftUI', 'Foundation'],
		description: 'Key-value preferences persistence backed by UserDefaults',
		aliases: [
			'shared_preferences',
			'sharedpreferences',
			'shared preferences',
			'android shared preferences',
		],
	},
	{
		idiom: 'localStorage',
		ecosystem: 'web',
		category: 'storage',
		appleSymbols: ['AppStorage', '@AppStorage', 'UserDefaults'],
		frameworks: ['SwiftUI', 'Foundation'],
		description: 'Client-side persistent key-value storage',
		aliases: [
			'local_storage',
			'localstorage',
			'local storage',
			'sessionStorage',
		],
	},
	{
		idiom: 'AsyncStorage',
		ecosystem: 'react',
		category: 'storage',
		appleSymbols: ['AppStorage', '@AppStorage', 'UserDefaults', 'SwiftData'],
		frameworks: ['SwiftUI', 'SwiftData', 'Foundation'],
		description: 'Asynchronous local key-value or document persistence',
		aliases: ['async_storage', 'asyncstorage', 'async storage', 'localforage'],
	},
	{
		idiom: 'Room',
		ecosystem: 'android',
		category: 'storage',
		appleSymbols: [
			'SwiftData',
			'ModelContainer',
			'ModelContext',
			'Query',
			'@Query',
			'CoreData',
		],
		frameworks: ['SwiftData', 'CoreData'],
		description: 'Object-relational mapping database framework',
		aliases: ['room database', 'room db', 'sqliteopenhelper', 'android room'],
	},

	// 4. Layout & UI
	{
		idiom: 'Flexbox',
		ecosystem: 'web',
		category: 'layout',
		appleSymbols: ['HStack', 'VStack', 'ZStack', 'Spacer', 'Layout'],
		frameworks: ['SwiftUI'],
		description: 'Flexible box layouts via HStack, VStack, and Spacer',
		aliases: [
			'flexbox',
			'display flex',
			'display: flex',
			'css flex',
			'flex-direction',
			'justify-content',
			'align-items',
		],
	},
	{
		idiom: 'CSS Grid',
		ecosystem: 'web',
		category: 'layout',
		appleSymbols: ['LazyVGrid', 'LazyHGrid', 'Grid', 'GridRow'],
		frameworks: ['SwiftUI'],
		description: 'Two-dimensional grid layouts',
		aliases: ['css grid', 'grid layout', 'display: grid', 'display grid'],
	},
	{
		idiom: 'RecyclerView',
		ecosystem: 'android',
		category: 'ui',
		appleSymbols: ['List', 'LazyVStack', 'LazyHStack', 'ScrollView'],
		frameworks: ['SwiftUI'],
		description: 'Virtualized scrollable list of reusable view items',
		aliases: [
			'recyclerview',
			'recycler view',
			'ListView',
			'flatlist',
			'FlatList',
		],
	},
	{
		idiom: 'Toast',
		ecosystem: 'android',
		category: 'ui',
		appleSymbols: ['alert', 'confirmationDialog', 'overlay'],
		frameworks: ['SwiftUI'],
		description: 'Transient alert banners and confirmation dialogs',
		aliases: [
			'snackbar',
			'Snackbar',
			'toast message',
			'toast notification',
			'android toast',
		],
	},
	{
		idiom: 'Modal',
		ecosystem: 'web',
		category: 'ui',
		appleSymbols: ['sheet', 'fullScreenCover', 'popover'],
		frameworks: ['SwiftUI'],
		description: 'Modal sheets, full-screen covers, and popovers',
		aliases: [
			'modal dialog',
			'modal sheet',
			'BottomSheet',
			'bottom sheet',
			'modal popup',
		],
	},
	{
		idiom: 'onClick',
		ecosystem: 'web',
		category: 'ui',
		appleSymbols: ['Button', 'onTapGesture'],
		frameworks: ['SwiftUI'],
		description: 'Tap or click gesture actions',
		aliases: ['setOnClickListener', 'on_click', 'onPress', 'on_press'],
	},

	// 5. Concurrency & Networking
	{
		idiom: 'coroutine',
		ecosystem: 'android',
		category: 'concurrency',
		appleSymbols: [
			'async',
			'await',
			'Task',
			'TaskGroup',
			'withTaskGroup',
			'AsyncStream',
		],
		frameworks: ['_Concurrency', 'SwiftUI'],
		description: 'Swift structured concurrency with async/await and Task',
		aliases: [
			'coroutines',
			'suspend fun',
			'suspend function',
			'dispatchers',
			'kotlin coroutines',
		],
	},
	{
		idiom: 'Retrofit',
		ecosystem: 'android',
		category: 'networking',
		appleSymbols: ['URLSession', 'URLRequest', 'data(from:)'],
		frameworks: ['Foundation'],
		description: 'HTTP client networking via URLSession',
		aliases: ['axios', 'fetch', 'okhttp', 'OkHttpClient'],
	},
	{
		idiom: 'WorkManager',
		ecosystem: 'android',
		category: 'concurrency',
		appleSymbols: ['BGTaskScheduler', 'BGAppRefreshTask', 'BGProcessingTask'],
		frameworks: ['BackgroundTasks'],
		description: 'Deferrable, guaranteed background processing',
		aliases: [
			'work_manager',
			'workmanager',
			'jobscheduler',
			'JobScheduler',
			'background service',
			'android service',
		],
	},

	// 6. Navigation
	{
		idiom: 'React Router',
		ecosystem: 'react',
		category: 'navigation',
		appleSymbols: [
			'NavigationStack',
			'NavigationLink',
			'NavigationPath',
			'NavigationSplitView',
		],
		frameworks: ['SwiftUI'],
		description: 'Declarative navigation stack and path-based routing',
		aliases: [
			'react-router',
			'react router',
			'NavController',
			'navcontroller',
			'navigation-compose',
			'jetpack navigation',
			'vue-router',
		],
	},
];

export interface QueryIdiomMatch {
	idiom: string;
	ecosystem: string;
	category: string;
	appleSymbols: string[];
	frameworks: string[];
	description: string;
}

export interface QueryExpansionResult {
	originalQuery: string;
	matchedIdioms: QueryIdiomMatch[];
	mappedSymbols: string[];
	expandedTerms: string[];
	expandedFtsQuery: string;
	semanticSearchQuery: string;
	hasExpansion: boolean;
}

/**
 * Escapes special SQLite FTS5 characters safely.
 */
function sanitizeFtsToken(token: string): string {
	return token.replace(/["*^]/g, '').trim();
}

/**
 * Escapes regular expression special characters.
 */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Inspects a query string, matches any cross-framework idioms (React hooks,
 * Android classes, Web CSS/APIs), and synthesizes both expanded lexical FTS terms
 * and rich semantic search context.
 */
export function expandQuery(query: string): QueryExpansionResult {
	const trimmed = (query || '').trim();
	if (!trimmed) {
		return {
			originalQuery: '',
			matchedIdioms: [],
			mappedSymbols: [],
			expandedTerms: [],
			expandedFtsQuery: '',
			semanticSearchQuery: '',
			hasExpansion: false,
		};
	}

	const normalizedQuery = trimmed.toLowerCase();
	// Normalize punctuation to spaces for token matching while preserving letters/digits
	const cleanQueryText = normalizedQuery.replace(/[^a-z0-9_]+/g, ' ');

	const matched: QueryIdiomMatch[] = [];
	const mappedSymbolsSet = new Set<string>();
	const expandedTermsSet = new Set<string>();

	for (const def of CROSS_FRAMEWORK_IDIOMS) {
		const termsToTest = [def.idiom, ...(def.aliases || [])];
		let isMatched = false;

		for (const term of termsToTest) {
			const normTerm = term.toLowerCase();

			// For single-token idiom
			if (!normTerm.includes(' ') && !normTerm.includes(':')) {
				const escaped = escapeRegex(normTerm);
				const regex = new RegExp(`(^|\\b|\\W)${escaped}(\\b|\\W|$)`, 'i');
				if (regex.test(trimmed)) {
					isMatched = true;
					break;
				}
			} else {
				// Multi-word phrase or CSS property (e.g. "shared preferences", "display: flex")
				const normPhrase = normTerm.replace(/[^a-z0-9_]+/g, ' ').trim();
				if (
					normalizedQuery.includes(normTerm) ||
					cleanQueryText.includes(normPhrase)
				) {
					isMatched = true;
					break;
				}
			}
		}

		if (isMatched) {
			matched.push({
				idiom: def.idiom,
				ecosystem: def.ecosystem,
				category: def.category,
				appleSymbols: def.appleSymbols,
				frameworks: def.frameworks,
				description: def.description,
			});

			for (const sym of def.appleSymbols) {
				// Strip leading @ or trailing parens for clean symbol token
				const cleanSym = sym.replace(/^@/, '').replace(/\(.*$/, '');
				mappedSymbolsSet.add(cleanSym);
				expandedTermsSet.add(cleanSym);
			}

			for (const fw of def.frameworks) {
				if (!fw.startsWith('_')) {
					expandedTermsSet.add(fw);
				}
			}
		}
	}

	const mappedSymbols = Array.from(mappedSymbolsSet);
	const expandedTerms = Array.from(expandedTermsSet);
	const hasExpansion = matched.length > 0;

	// Build expanded FTS query:
	// If idioms matched, combine original query with top Apple symbols
	let expandedFtsQuery = trimmed;
	if (hasExpansion && mappedSymbols.length > 0) {
		const cleanOrig = sanitizeFtsToken(trimmed);
		const topSymbols = mappedSymbols.slice(0, 4).map(sanitizeFtsToken);
		expandedFtsQuery = `${cleanOrig} OR ${topSymbols.join(' OR ')}`.trim();
	}

	// Build enriched semantic search query:
	// Adds Apple context to the vector embedding prompt so embedding models
	// align the user's cross-framework mental model with Apple SDK symbols.
	let semanticSearchQuery = trimmed;
	if (hasExpansion && mappedSymbols.length > 0) {
		const symbolList = mappedSymbols.slice(0, 5).join(', ');
		const frameworkList = Array.from(
			new Set(
				matched.flatMap((m) => m.frameworks).filter((f) => !f.startsWith('_')),
			),
		).join(', ');

		const frameworkHint = frameworkList ? ` in ${frameworkList}` : '';
		semanticSearchQuery = `${trimmed} (Apple Swift${frameworkHint} equivalent: ${symbolList})`;
	}

	return {
		originalQuery: trimmed,
		matchedIdioms: matched,
		mappedSymbols,
		expandedTerms,
		expandedFtsQuery,
		semanticSearchQuery,
		hasExpansion,
	};
}
