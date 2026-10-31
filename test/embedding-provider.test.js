import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmbeddingProvider } from '../dist/server/services/search/embedding-provider.js';

test('isEmbeddingProvider returns true for valid provider object', () => {
	const mock = {
		id: 'local-gguf',
		dimensions: 768,
		isAvailable: () => true,
		embedQuery: async () => new Float32Array(768),
		embedDocument: async () => new Float32Array(768),
	};
	assert.equal(isEmbeddingProvider(mock), true);
	assert.equal(isEmbeddingProvider(null), false);
	assert.equal(isEmbeddingProvider({}), false);
	assert.equal(isEmbeddingProvider({ id: 'unknown' }), false);
});
