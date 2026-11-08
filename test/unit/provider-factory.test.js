import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolveEmbeddingProvider } from '../../dist/server/services/search/provider-factory.js';

const LOCAL_MODEL =
	'/Users/andrew/Documents/GitHub/Models/embeddinggemma-2-Q8_0.gguf';

test('resolveEmbeddingProvider prefers Gemini when API key is present even if local model exists', () => {
	const provider = resolveEmbeddingProvider({
		localModelPath: LOCAL_MODEL,
		geminiApiKey: 'test-key',
	});
	assert.equal(provider.id, 'gemini');
	assert.equal(provider.dimensions, 768);
});

test('resolveEmbeddingProvider selects local GGUF when Gemini is absent but local model exists', (t) => {
	if (!existsSync(LOCAL_MODEL)) {
		// The GGUF only exists on the author's Mac; skip rather than fail CI/VPS.
		t.skip(`local GGUF model not present at ${LOCAL_MODEL}`);
		return;
	}
	const provider = resolveEmbeddingProvider({
		localModelPath: LOCAL_MODEL,
		geminiApiKey: null,
		disableAdc: true,
	});
	assert.equal(provider.id, 'local-gguf');
	assert.equal(provider.dimensions, 768);
});

test('resolveEmbeddingProvider respects APPLE_DOCS_EMBEDDING_PROVIDER=local override', (t) => {
	if (!existsSync(LOCAL_MODEL)) {
		t.skip(`local GGUF model not present at ${LOCAL_MODEL}`);
		return;
	}
	const provider = resolveEmbeddingProvider({
		preferredProvider: 'local',
		localModelPath: LOCAL_MODEL,
		geminiApiKey: 'test-key',
	});
	assert.equal(provider.id, 'local-gguf');
});

test('resolveEmbeddingProvider returns unavailable provider when neither is present', () => {
	const provider = resolveEmbeddingProvider({
		localModelPath: '/non/existent.gguf',
		geminiApiKey: null,
		disableAdc: true,
	});
	assert.equal(provider.isAvailable(), false);
});
