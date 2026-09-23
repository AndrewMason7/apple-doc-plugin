import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';

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
	assert.ok(
		warnings.some(
			(line) => line.includes('guide-wrong-width') && line.includes('3 dims'),
		),
	);

	db.close();
});

test('HybridSearchEngine rejects a non-3072 embedding and still returns lexical hits', async () => {
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
		assert.strictEqual(engine['semanticSearch'].expectedDimensions, 3072);
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
