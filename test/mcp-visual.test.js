import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';
import { AppleDevDocsClient } from '../dist/apple-client.js';

test('search_symbols includes visual preview markdown when item has mediaUrl', async () => {
	const db = new AppleDocsDB(':memory:');
	const vec = new Float32Array(3072);
	vec[0] = 1.0;

	db.insertSemanticItem({
		id: 'test-preview',
		framework: 'SwiftUI',
		title: 'NavigationSplitView Preview',
		kind: 'ui_preview',
		summary: 'Visual layout on iPad.',
		path: '/documentation/swiftui/navigationsplitview',
		mediaUrl: 'https://developer.apple.com/tutorials/images/test.png',
		mediaType: 'image/png',
		embedding: vec,
	});

	const searchEngine = new HybridSearchEngine(db, { apiKey: null });

	// Test searchSemanticWithVector returns mediaUrl
	const matches = searchEngine.searchSemanticWithVector(vec);
	assert.strictEqual(matches.length, 1);
	assert.strictEqual(
		matches[0].mediaUrl,
		'https://developer.apple.com/tutorials/images/test.png',
	);

	db.close();
});
