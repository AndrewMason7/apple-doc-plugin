import assert from 'node:assert';
import test from 'node:test';

import {
	resolveEmbeddingProvider,
	resolveRequestedDimensions,
	SUPPORTED_EMBEDDING_DIMENSIONS,
} from '../dist/server/services/search/provider-factory.js';

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
	assert.strictEqual(full.dimensions, 3072, '3072 remains the default');

	const truncated = resolveEmbeddingProvider({
		preferredProvider: 'gemini',
		geminiApiKey: 'test-key',
		dimensions: 768,
	});
	assert.strictEqual(truncated.dimensions, 768);
});
