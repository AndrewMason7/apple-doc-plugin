import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';

test('search results format runnable get_documentation invocation and backticked path', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/navigationstack',
		framework: 'SwiftUI',
		title: 'NavigationStack',
		kind: 'struct',
		abstract: 'A view that displays a root view.',
		path: '/documentation/swiftui/navigationstack',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});

	const searchEngine = {
		search: async () => [
			{
				id: 'documentation/swiftui/navigationstack',
				framework: 'SwiftUI',
				title: 'NavigationStack',
				kind: 'struct',
				abstract: 'A view that displays a root view.',
				path: '/documentation/swiftui/navigationstack',
				platforms: ['iOS', 'macOS'],
				score: 100,
				source: 'fts',
			},
		],
		hasSemanticAuth: () => false,
		isCircuitOpen: () => false,
	};

	const handler = buildSearchSymbolsHandler({
		client: {},
		state: new ServerState(),
		db,
		searchEngine,
	});

	const res = await handler({ query: 'NavigationStack' });
	const text = res.content[0].text;

	assert.ok(
		text.includes('• **Path:** `/documentation/swiftui/navigationstack`'),
		'Path must be wrapped in backticks',
	);
	assert.ok(
		text.includes(
			'• **Doc Call:** `get_documentation({ "path": "/documentation/swiftui/navigationstack", "framework": "SwiftUI" })`',
		),
		'Must include runnable get_documentation call with path and framework',
	);

	db.close();
});
