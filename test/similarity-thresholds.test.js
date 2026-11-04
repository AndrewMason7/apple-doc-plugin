import assert from 'node:assert';
import test from 'node:test';

import { resolveMinSimilarity } from '../dist/server/services/search/hybrid-search.js';
import { LocalGemmaEmbeddingProvider } from '../dist/server/services/search/local-gemma-provider.js';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';

test('local EmbeddingGemma advertises thresholds measured on this corpus', () => {
	const provider = new LocalGemmaEmbeddingProvider('/nonexistent.gguf');

	// Measured with the Q8_0 GGUF: relevant symbols score 0.688-0.719, while
	// unrelated ones top out around 0.66. Gemini-tuned 0.65 lets that noise in.
	assert.strictEqual(provider.minSimilarity, 0.68);
	assert.ok(provider.minSimilarityPreferred < provider.minSimilarity);
});

test('resolveMinSimilarity uses the provider thresholds, not hardcoded Gemini ones', () => {
	const local = new LocalGemmaEmbeddingProvider('/nonexistent.gguf');
	const gemini = new GeminiSemanticSearch('dummy-key');

	assert.strictEqual(resolveMinSimilarity(local, false), 0.68);
	assert.strictEqual(resolveMinSimilarity(local, true), 0.62);
	assert.strictEqual(resolveMinSimilarity(gemini, false), 0.65);
	assert.strictEqual(resolveMinSimilarity(gemini, true), 0.55);
});

test('resolveMinSimilarity falls back to the historical defaults for unknown providers', () => {
	const bare = {
		id: 'unavailable',
		dimensions: 0,
		isAvailable: () => false,
		embedQuery: async () => null,
		embedDocument: async () => null,
	};

	assert.strictEqual(resolveMinSimilarity(bare, false), 0.65);
	assert.strictEqual(resolveMinSimilarity(bare, true), 0.55);
});
