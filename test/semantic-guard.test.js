import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';

test('HybridSearchEngine skips RRF when semantic items < 100 and prevents demoting exact lexical hits', async () => {
	const db = new AppleDocsDB(':memory:');

	// Insert exact symbol match
	db.insertSymbol({
		id: 'documentation/swiftui/navigationstack',
		framework: 'SwiftUI',
		title: 'NavigationStack',
		kind: 'struct',
		abstract: 'A view that displays a root view.',
		path: '/documentation/swiftui/navigationstack',
		platforms: ['iOS 16.0+'],
		isPrimaryType: true,
	});

	// Insert a semantic item (only 1 item in semantic_items, < 100 threshold)
	const mockEmbedding = new Float32Array(3072);
	mockEmbedding[0] = 1.0;
	db.insertSemanticItem({
		id: 'overview-image',
		framework: 'SwiftUI',
		title: 'Mount Fuji Navigation Diagram',
		kind: 'ui_preview',
		summary: 'A visual diagram of hierarchical navigation.',
		path: '/tutorials/swiftui/navigation-diagram',
		embedding: mockEmbedding,
	});

	assert.strictEqual(
		db.getSemanticItemCount(),
		1,
		'Semantic items count should be 1',
	);

	// Mock server that returns high similarity for the query
	const server = http.createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		const values = new Array(3072).fill(0);
		values[0] = 0.99;
		res.end(JSON.stringify({ embedding: { values } }));
	});
	await new Promise((resolve) => server.listen(0, resolve));
	const port = server.address().port;

	try {
		const engine = new HybridSearchEngine(db, {
			apiKey: 'test-key',
			baseUrl: `http://127.0.0.1:${port}`,
			modelName: 'models/test-model',
		});

		// Search with preferSemantic: true
		const results = await engine.search('NavigationStack', {
			preferSemantic: true,
		});

		// Exact lexical hit must NOT be demoted by the single semantic item when under threshold
		assert.strictEqual(
			results[0].title,
			'NavigationStack',
			'NavigationStack must remain #1 hit',
		);
		assert.strictEqual(
			results[0].source,
			'fts',
			'Result source should be fts due to threshold guard',
		);

		// Handler should report lexical fallback notice in the markdown header
		const state = new ServerState();
		const handler = buildSearchSymbolsHandler({
			client: {},
			state,
			db,
			searchEngine: engine,
		});

		const res = await handler({
			query: 'NavigationStack',
			preferSemantic: true,
		});
		const text = res.content[0].text;
		assert.ok(
			text.includes(
				'Lexical fallback (semantic index has 1 items; symbol embeddings require build:index)',
			),
			`Search mode should explain lexical fallback when under 100 items. Got: ${text}`,
		);
	} finally {
		server.close();
		db.close();
	}
});
