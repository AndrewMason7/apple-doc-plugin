import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import {
	AppleDocsDB,
	deserializeFloat32Array,
} from '../dist/server/db/database.js';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';

test('Tribunal Stress 1: HTTP Error Logging does not expose API key in URL or error output', async () => {
	let capturedLog = '';
	const originalError = console.error;
	console.error = (...args) => {
		capturedLog += args.join(' ') + '\n';
	};

	const server = http.createServer((req, res) => {
		res.writeHead(500, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: { message: 'Internal Server Error' } }));
	});

	await new Promise((resolve) => server.listen(0, resolve));
	const port = server.address().port;
	const baseUrl = `http://127.0.0.1:${port}`;
	const secretKey = 'ultra-secret-api-key-999';

	try {
		const search = new GeminiSemanticSearch(
			secretKey,
			'models/stress-model',
			baseUrl,
		);
		const res = await search.embedQuery('stress query');
		assert.strictEqual(res, null);
		assert(
			!capturedLog.includes(secretKey),
			'Secret API key must never appear in logs or error messages',
		);
		assert.strictEqual(
			search.isCircuitOpen(),
			true,
			'500 status should trip circuit breaker',
		);
	} finally {
		console.error = originalError;
		server.close();
	}
});

test('Tribunal Stress 2: Buffer Alignment across various odd offsets and sizes', () => {
	for (const offset of [1, 2, 3, 5, 7]) {
		const floatCount = 16;
		const original = new Float32Array(floatCount);
		for (let i = 0; i < floatCount; i++) original[i] = i * 1.337;

		const raw = Buffer.alloc(offset + original.byteLength + 8);
		Buffer.from(original.buffer).copy(raw, offset);

		const slice = raw.subarray(offset, offset + original.byteLength);
		assert.strictEqual(slice.byteOffset % 4, offset % 4);

		const recovered = deserializeFloat32Array(slice);
		assert.strictEqual(recovered.length, floatCount);
		for (let i = 0; i < floatCount; i++) {
			assert(Math.abs(recovered[i] - original[i]) < 1e-5);
		}
	}
});

test('Tribunal Stress 3: Malicious and Adversarial FTS5 Syntax Attacks', () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'test-sym',
		framework: 'SwiftUI',
		title: 'Text',
		kind: 'struct',
		abstract: 'A view that displays one or more lines of read-only text.',
		path: '/documentation/swiftui/text',
		platforms: ['iOS 13.0+'],
	});

	const adversarialQueries = [
		'View (SwiftUI) : * ^',
		'SwiftUI.View',
		'some View { body: some View }',
		'[AnyView]',
		'foo:bar',
		'"""""',
		'***',
		'()())(',
		'NEAR(text, 5)',
		'MATCH "syntax" OR *',
		"'; DROP TABLE symbols; --",
		'NOT AND OR XOR',
		'123 456 789 000',
		'%_%_%_%%',
		'\\\\\\\\\\',
	];

	for (const q of adversarialQueries) {
		const res = db.queryFTS(q);
		assert.ok(
			Array.isArray(res),
			`Query ${JSON.stringify(q)} must return an array`,
		);
	}

	const surviving = db.getSymbolByPath('/documentation/swiftui/text');
	assert.ok(surviving);
	assert.strictEqual(surviving.title, 'Text');
	assert.strictEqual(
		surviving.abstract,
		'A view that displays one or more lines of read-only text.',
	);
	const table = db['db']
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'symbols'",
		)
		.get();
	assert.ok(table, 'Adversarial queries must not drop the symbols table');
	assert.strictEqual(db.queryFTS('Text')[0].title, 'Text');

	db.close();
});

test('Tribunal Stress 4: Corrupted Metadata Resilience', () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'broken-meta',
		framework: 'SwiftUI',
		title: 'Broken',
		kind: 'struct',
		abstract: 'Broken symbol',
		path: '/documentation/swiftui/broken',
		platforms: ['iOS'],
	});

	const corruptions = [
		'{not a json',
		'undefined',
		'null',
		'12345',
		'["unclosed string',
		'{"key": true}', // object instead of array
		'',
	];

	for (const badPlatforms of corruptions) {
		// @ts-ignore
		db['db']
			.prepare("UPDATE symbols SET platforms = ? WHERE id = 'broken-meta'")
			.run(badPlatforms);

		const sym = db.getSymbolByPath('/documentation/swiftui/broken');
		assert(sym !== null);
		assert(Array.isArray(sym.platforms));

		const fts = db.queryFTS('Broken');
		assert(fts.length > 0);
		assert(Array.isArray(fts[0].platforms));
	}

	db.close();
});

test('Tribunal Stress 5: Concurrent Hybrid Searches under Circuit Breaker', async () => {
	const db = new AppleDocsDB(':memory:');
	for (let i = 0; i < 20; i++) {
		db.insertSymbol({
			id: `symbol-${i}`,
			framework: 'SwiftUI',
			title: `ViewComponent${i}`,
			kind: 'struct',
			abstract: `Component number ${i} description.`,
			path: `/documentation/swiftui/comp${i}`,
			platforms: ['iOS 17.0+'],
		});
	}

	const engine = new HybridSearchEngine(db, { apiKey: 'mock-key-testing' });
	// Trip breaker
	// @ts-ignore
	engine['semanticSearch'].tripCircuitBreaker(60_000);

	// Run 50 concurrent searches - must all resolve rapidly without hangs
	const t0 = performance.now();
	const searchPromises = Array.from({ length: 50 }, (_, i) =>
		engine.search(`ViewComponent${i % 20}`),
	);
	const results = await Promise.all(searchPromises);
	const t1 = performance.now();

	assert.strictEqual(results.length, 50);
	for (const r of results) {
		assert(r.length > 0);
		assert.strictEqual(r[0].source, 'fts');
	}
	assert(
		t1 - t0 < 500,
		`50 concurrent searches should complete in <500ms, took ${t1 - t0}ms`,
	);

	db.close();
});
