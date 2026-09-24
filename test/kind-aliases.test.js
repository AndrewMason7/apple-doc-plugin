import assert from 'node:assert';
import test from 'node:test';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';

test('symbolType: "func" matches symbols with kind "method" via alias', async () => {
	const searchEngine = {
		search: async () => [
			{
				id: 'documentation/swiftui/view/interactivedismissdisabled(_:)',
				framework: 'SwiftUI',
				title: 'interactiveDismissDisabled(_:)',
				kind: 'method', // In DocC / db, SwiftUI view modifiers are stored as "method"
				abstract: 'Specifies whether to prevent user dismiss.',
				path: '/documentation/swiftui/view/interactivedismissdisabled(_:)',
				platforms: ['iOS'],
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
		searchEngine,
	});

	// Agent requests symbolType: "func"
	const res = await handler({
		query: 'interactiveDismissDisabled',
		symbolType: 'func',
	});
	const text = res.content[0].text;

	assert.ok(
		text.includes('interactiveDismissDisabled(_:)'),
		'Should find method when filtering by func',
	);
	assert.ok(
		text.includes('Kind:** method'),
		'Should display the method match',
	);
});

test('kind filter that matches 0 symbols falls back to all results with a note', async () => {
	const searchEngine = {
		search: async () => [
			{
				id: 'documentation/swiftui/button',
				framework: 'SwiftUI',
				title: 'Button',
				kind: 'struct',
				abstract: 'A button.',
				path: '/documentation/swiftui/button',
				platforms: ['iOS'],
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
		searchEngine,
	});

	// Agent requests symbolType: "nonexistentkind"
	const res = await handler({
		query: 'Button',
		symbolType: 'nonexistentkind',
	});
	const text = res.content[0].text;

	assert.ok(
		text.includes('Button'),
		'Should retain results when kind filter matches 0 items',
	);
	assert.ok(
		text.includes('matched 0 symbols; showing all kinds'),
		'Should display fallback note',
	);
});
