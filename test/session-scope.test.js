import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';

test('search_symbols without framework executes globally across all frameworks in stateless mode', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/appkit/nsbutton',
		framework: 'AppKit',
		title: 'NSButton',
		kind: 'class',
		abstract: 'A button.',
		path: '/documentation/appkit/nsbutton',
		platforms: ['macOS'],
	});
	db.insertSymbol({
		id: 'documentation/swiftui/navigationstack',
		framework: 'SwiftUI',
		title: 'NavigationStack',
		kind: 'struct',
		abstract: 'A root view for navigation.',
		path: '/documentation/swiftui/navigationstack',
		platforms: ['iOS'],
	});

	const state = new ServerState();
	let capturedFramework = 'uncalled';
	const searchEngine = {
		search: async (query, options) => {
			capturedFramework = options.framework;
			return db.queryFTS(query, options.framework, options.limit);
		},
		hasSemanticAuth: () => false,
		isCircuitOpen: () => false,
	};

	const searchHandler = buildSearchSymbolsHandler({
		client: {},
		state,
		db,
		searchEngine,
	});

	const res = await searchHandler({ query: 'NavigationStack' });
	const text = res.content[0].text;

	// Search must execute globally: options.framework must be undefined
	assert.strictEqual(
		capturedFramework,
		undefined,
		'Global search must not set framework scope',
	);
	assert.ok(
		text.includes('NavigationStack'),
		'Should find SwiftUI NavigationStack',
	);

	db.close();
});
