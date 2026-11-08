import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import { HybridSearchEngine } from '../../dist/server/services/search/hybrid-search.js';
import { GeminiSemanticSearch } from '../../dist/server/services/search/semantic-search.js';

test('HybridSearchEngine fuses a semantic hit with its lexical twin instead of duplicating it', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: '/documentation/swiftui/navigationsplitview',
		framework: 'SwiftUI',
		title: 'NavigationSplitView',
		kind: 'struct',
		abstract: 'A view that displays a split-view hierarchy.',
		path: '/documentation/swiftui/navigationsplitview',
		platforms: ['iOS 16.0+'],
		isPrimaryType: true,
	});

	// The symbol layer stores vectors under `sym-<symbolId>`; fusion must map
	// that back to the symbol id or RRF emits the document twice.
	const embedding = new Float32Array(768);
	embedding[0] = 1;
	db.insertSemanticItem({
		id: 'sym-/documentation/swiftui/navigationsplitview',
		framework: 'SwiftUI',
		title: 'NavigationSplitView',
		kind: 'struct',
		summary: 'A view that displays a split-view hierarchy.',
		path: '/documentation/swiftui/navigationsplitview',
		embedding,
	});

	const provider = {
		id: 'stub',
		dimensions: 768,
		minSimilarity: 0.5,
		isAvailable: () => true,
		embedQuery: async () => embedding,
		embedDocument: async () => embedding,
	};

	const engine = new HybridSearchEngine(db, { embeddingProvider: provider });
	const results = await engine.search('NavigationSplitView', {
		limit: 10,
		minSemanticItems: 1,
	});

	const hits = results.filter(
		(r) => r.path === '/documentation/swiftui/navigationsplitview',
	);
	assert.strictEqual(
		hits.length,
		1,
		`the same document must not appear twice, got ${hits.length}`,
	);
	assert.strictEqual(hits[0].source, 'hybrid');
	db.close();
});

test('HybridSearchEngine keeps idiom expansion out of the lexical-only path', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftdata/modelcontainer',
		framework: 'SwiftData',
		title: 'ModelContainer',
		kind: 'class',
		abstract: 'A container that manages SwiftData models.',
		path: '/documentation/swiftdata/modelcontainer',
		platforms: ['iOS 17.0+'],
		isPrimaryType: true,
	});

	const engine = new HybridSearchEngine(db, { apiKey: null });

	// `search_symbols` is precise lexical search: expansion must not inject
	// symbols the caller never typed.
	const lexical = await engine.search('Room database', { lexicalOnly: true });
	assert.ok(
		!lexical.some((r) => r.title === 'ModelContainer'),
		'lexical-only search must not inject idiom-mapped symbols',
	);

	// `semantic_search` is the natural-language tool, so expansion applies.
	const expanded = await engine.search('Room database');
	assert.ok(
		expanded.some((r) => r.title === 'ModelContainer'),
		'semantic search should inject idiom-mapped symbols',
	);
	db.close();
});

test('HybridSearchEngine returns scored results without Gemini key', async () => {
	const db = new AppleDocsDB(':memory:');
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
	db.insertSymbol({
		id: 'documentation/swiftui/navigationpath',
		framework: 'SwiftUI',
		title: 'NavigationPath',
		kind: 'struct',
		abstract: 'A type-erased list of data representing the navigation stack.',
		path: '/documentation/swiftui/navigationpath',
		platforms: ['iOS 16.0+'],
		isPrimaryType: true,
	});

	const engine = new HybridSearchEngine(db, { apiKey: null });
	const results = await engine.search('NavigationStack');

	assert.strictEqual(results.length, 2);
	assert.strictEqual(results[0].title, 'NavigationStack'); // Exact match boosted
	assert(results[0].score > results[1].score);
	db.close();
});

test('GeminiSemanticSearch computes cosine similarity correctly', () => {
	const semantic = new GeminiSemanticSearch();
	const v1 = new Float32Array([1, 0, 0]);
	const v2 = new Float32Array([1, 0, 0]);
	const v3 = new Float32Array([0, 1, 0]);

	assert.strictEqual(semantic.cosineSimilarity(v1, v2), 1.0);
	assert.strictEqual(semantic.cosineSimilarity(v1, v3), 0.0);
});

test('HybridSearchEngine performs semantic vector match if items exist in DB', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/corelocation/cllocationmanager',
		framework: 'CoreLocation',
		title: 'CLLocationManager',
		kind: 'class',
		abstract:
			'The object that you use to start and stop the delivery of location-related events.',
		path: '/documentation/corelocation/cllocationmanager',
		platforms: ['iOS 2.0+'],
		isPrimaryType: true,
	});

	// Insert mock semantic item
	const mockEmbedding = new Float32Array(768);
	mockEmbedding[0] = 1.0;
	db.insertSemanticItem({
		id: 'guide-location',
		framework: 'CoreLocation',
		title: 'Tracking User Location in the Background',
		kind: 'guide',
		summary:
			'Configure background location updates and request appropriate permissions.',
		path: '/documentation/corelocation/tracking_location',
		embedding: mockEmbedding,
	});

	const engine = new HybridSearchEngine(db);
	// Inject mock query embedding
	const queryVec = new Float32Array(768);
	queryVec[0] = 0.99;
	const semanticMatches = engine.searchSemanticWithVector(queryVec);

	assert.strictEqual(semanticMatches.length, 1);
	assert.strictEqual(
		semanticMatches[0].title,
		'Tracking User Location in the Background',
	);
	assert.ok(semanticMatches[0].similarity > 0.9);

	const mismatched = new Float32Array(3);
	mismatched[0] = 1;
	db.insertSemanticItem({
		id: 'guide-wrong-width',
		framework: 'CoreLocation',
		title: 'Wrong Width',
		kind: 'guide',
		summary: 'This vector must be skipped.',
		path: '/documentation/corelocation/wrong',
		embedding: mismatched,
	});
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => {
		warnings.push(args.join(' '));
	};
	try {
		const filtered = engine.searchSemanticWithVector(queryVec);
		assert.strictEqual(filtered.length, 1);
		assert.strictEqual(filtered[0].id, 'guide-location');
	} finally {
		console.warn = originalWarn;
	}
	// The width comparison is a corpus-level fact, so it is reported once —
	// naming the widths and both remedies, not the id of the one bad row.
	assert.match(
		warnings.join('\n'),
		/3-d/,
		`expected the stored width in the warning, got:\n${warnings.join('\n')}`,
	);
	assert.match(warnings.join('\n'), /768-d/);

	db.close();
});

// Regression for the upgrade path: a pre-768 corpus used to emit one warning
// per stored row (~19.5k lines per query) while silently dropping every match.
test('a stale-width corpus warns exactly once per query with both remedies', () => {
	const db = new AppleDocsDB(':memory:');
	for (let i = 0; i < 50; i++) {
		const embedding = new Float32Array(3072);
		embedding[0] = 0.5;
		db.insertSemanticItem({
			id: `stale-${i}`,
			framework: 'SwiftUI',
			title: `Stale ${i}`,
			kind: 'struct',
			summary: 'vector of the old width',
			path: '/documentation/swiftui/stale',
			embedding,
		});
	}

	const engine = new HybridSearchEngine(db, { apiKey: null });
	const queryVec = new Float32Array(768);
	queryVec[0] = 1;

	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => {
		warnings.push(args.join(' '));
	};
	try {
		assert.deepStrictEqual(engine.searchSemanticWithVector(queryVec), []);
		assert.deepStrictEqual(engine.searchSemanticWithVector(queryVec), []);
	} finally {
		console.warn = originalWarn;
	}

	assert.strictEqual(
		warnings.length,
		1,
		`50 stale rows must cost one warning, got ${warnings.length}:\n${warnings.join('\n')}`,
	);
	assert.match(warnings[0], /APPLE_DOCS_EMBEDDING_DIMENSIONS=3072/);
	assert.match(warnings[0], /npm run embed-index -- --force/);
	assert.match(warnings[0], /768/);
	db.close();
});

test('HybridSearchEngine rejects a wrong-width embedding and still returns lexical hits', async () => {
	const server = http.createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3, 0.4] } }));
	});
	await new Promise((resolve) => server.listen(0, resolve));
	const port = server.address().port;

	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A type that represents part of the user interface.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS'],
		isPrimaryType: true,
	});

	try {
		const engine = new HybridSearchEngine(db, {
			apiKey: 'test-key',
			baseUrl: `http://127.0.0.1:${port}`,
			modelName: 'models/test-model',
		});
		assert.strictEqual(
			engine['semanticSearch'].expectedDimensions,
			768,
			'engine must pin the 768 default that matches the shipped index',
		);
		assert.strictEqual(engine['semanticSearch'].dimensions, 768);
		const results = await engine.search('View');
		assert.strictEqual(results[0].title, 'View');
		assert.strictEqual(results[0].source, 'fts');
		assert.strictEqual(results[0].score, 1100);
	} finally {
		server.close();
		db.close();
	}
});

test('GeminiSemanticSearch computes cosine similarity with precomputed norms', () => {
	const semantic = new GeminiSemanticSearch();
	const v1 = new Float32Array([3, 4]); // norm = 5
	const v2 = new Float32Array([6, 8]); // norm = 10
	const sim = semantic.cosineSimilarityWithNorm(v1, 5, v2, 10);
	assert(Math.abs(sim - 1.0) < 1e-6);

	const v3 = new Float32Array([-4, 3]); // orthogonal, norm = 5
	const simOrth = semantic.cosineSimilarityWithNorm(v1, 5, v3, 5);
	assert(Math.abs(simOrth - 0.0) < 1e-6);
});

test('HybridSearchEngine elevates semantic matches over lexical matches when preferSemantic is true', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/button',
		framework: 'SwiftUI',
		title: 'Button',
		kind: 'struct',
		abstract: 'A control that initiates an action.',
		path: '/documentation/swiftui/button',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});

	// Fixtures use the shipped index width (768) so the default query width matches.
	const mockEmbedding = new Float32Array(768);
	mockEmbedding[0] = 1.0;
	db.insertSemanticItem({
		id: 'guide-custom-action',
		framework: 'SwiftUI',
		title: 'Custom Action Triggers',
		kind: 'guide',
		summary: 'Learn how to trigger actions in response to custom user events.',
		path: '/documentation/swiftui/custom_action',
		embedding: mockEmbedding,
	});

	const server = http.createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		const values = new Array(768).fill(0);
		values[0] = 0.95;
		res.end(JSON.stringify({ embedding: { values } }));
	});
	await new Promise((resolve) => server.listen(0, resolve));
	const port = server.address().port;

	try {
		const engine = new HybridSearchEngine(db, {
			apiKey: 'test-key',
			baseUrl: `http://127.0.0.1:${port}`,
			modelName: 'models/test-model',
			minSemanticItems: 1,
		});

		const results = await engine.search('trigger action', {
			preferSemantic: true,
		});
		assert.ok(results.length >= 1);
		assert.strictEqual(results[0].id, 'guide-custom-action');
		assert.strictEqual(results[0].source, 'semantic');
	} finally {
		server.close();
		db.close();
	}
});

test('HybridSearchEngine works seamlessly with 768-dimensional local provider', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/navigationsplitview',
		framework: 'SwiftUI',
		title: 'NavigationSplitView',
		kind: 'struct',
		abstract: 'A view that presents views in two or three columns.',
		path: '/documentation/swiftui/navigationsplitview',
		platforms: ['iOS 16.0+'],
		isPrimaryType: true,
	});

	const mock768 = new Float32Array(768);
	mock768[0] = 1.0;
	db.insertSemanticItem({
		id: 'documentation/swiftui/navigationsplitview',
		framework: 'SwiftUI',
		title: 'NavigationSplitView',
		kind: 'struct',
		summary: 'A view that presents views in two or three columns.',
		path: '/documentation/swiftui/navigationsplitview',
		embedding: mock768,
	});

	const mockLocal = {
		id: 'local-gguf',
		dimensions: 768,
		isAvailable: () => true,
		embedQuery: async () => mock768,
		embedDocument: async () => mock768,
	};

	const engine = new HybridSearchEngine(db, {
		embeddingProvider: mockLocal,
		minSemanticItems: 1,
	});
	const results = await engine.search('column layout', {
		preferSemantic: true,
	});
	assert.ok(Array.isArray(results));
	assert.ok(results.length > 0);
	assert.equal(results[0].title, 'NavigationSplitView');
	db.close();
});
