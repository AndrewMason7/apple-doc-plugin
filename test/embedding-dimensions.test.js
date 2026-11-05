import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';

import {
	resolveEmbeddingProvider,
	resolveRequestedDimensions,
	SUPPORTED_EMBEDDING_DIMENSIONS,
} from '../dist/server/services/search/provider-factory.js';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';

test('supported dimensions match the model family MRL steps', () => {
	assert.deepStrictEqual(
		SUPPORTED_EMBEDDING_DIMENSIONS,
		[128, 256, 512, 768, 1024, 1536, 2048, 3072],
	);
});

test('resolveRequestedDimensions accepts a supported truncation', () => {
	assert.strictEqual(resolveRequestedDimensions('768'), 768);
	assert.strictEqual(resolveRequestedDimensions('1024'), 1024);
	assert.strictEqual(resolveRequestedDimensions(' 512 '), 512);
});

test('resolveRequestedDimensions rejects unsupported values instead of guessing', () => {
	assert.strictEqual(resolveRequestedDimensions('999'), undefined);
	assert.strictEqual(resolveRequestedDimensions('abc'), undefined);
	assert.strictEqual(resolveRequestedDimensions('0'), undefined);
	assert.strictEqual(resolveRequestedDimensions(undefined), undefined);
});

test('resolveEmbeddingProvider passes the requested dimensions to the provider', () => {
	// Force the hosted provider: a local GGUF on disk would otherwise win precedence.
	const full = resolveEmbeddingProvider({
		preferredProvider: 'gemini',
		geminiApiKey: 'test-key',
	});
	assert.strictEqual(full.id, 'gemini');
	// The default is intentionally 768 so a fresh install writes vectors that are
	// comparable with the ones shipped in data/apple-docs.db.
	assert.strictEqual(
		full.dimensions,
		768,
		'the default matches the shipped index',
	);

	const truncated = resolveEmbeddingProvider({
		preferredProvider: 'gemini',
		geminiApiKey: 'test-key',
		dimensions: 768,
	});
	assert.strictEqual(truncated.dimensions, 768);
});

test('GeminiSemanticSearch defaults to 768 dimensions to match the shipped index', async () => {
	let receivedBody = null;
	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => {
			raw += chunk;
		});
		req.on('end', () => {
			receivedBody = JSON.parse(raw);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({ embedding: { values: new Array(768).fill(0.02) } }),
			);
		});
	});

	await new Promise((resolve) => server.listen(0, resolve));
	const baseUrl = `http://127.0.0.1:${server.address().port}`;

	try {
		const search = new GeminiSemanticSearch(
			'test-key',
			'models/gemini-embedding-2',
			baseUrl,
		);
		assert.strictEqual(
			search.dimensions,
			768,
			'default must match the shipped 768-d index, not the model native 3072',
		);
		const vec = await search.embedQuery('default width');
		assert.ok(vec instanceof Float32Array);
		assert.strictEqual(vec.length, 768);
		assert.strictEqual(
			receivedBody.output_dimensionality,
			768,
			'must request the default width from the API',
		);
	} finally {
		server.close();
	}
});
