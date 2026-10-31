import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { LocalGemmaEmbeddingProvider } from '../dist/server/services/search/local-gemma-provider.js';

test('LocalGemmaEmbeddingProvider reports unavailable if model file does not exist', () => {
	const provider = new LocalGemmaEmbeddingProvider('/non/existent/model.gguf');
	assert.equal(provider.isAvailable(), false);
	assert.equal(provider.dimensions, 768);
});

test('LocalGemmaEmbeddingProvider formats query with task prefix', () => {
	assert.equal(
		LocalGemmaEmbeddingProvider.prepareQuery('NavigationSplitView'),
		'task: search result | query: NavigationSplitView',
	);
	assert.equal(
		LocalGemmaEmbeddingProvider.prepareQuery(
			'task: code retrieval | query: test',
		),
		'task: code retrieval | query: test',
	);
	assert.equal(LocalGemmaEmbeddingProvider.prepareQuery(''), '');
	assert.equal(LocalGemmaEmbeddingProvider.prepareQuery('   '), '');
});

test('LocalGemmaEmbeddingProvider formats document with title prefix', () => {
	assert.equal(
		LocalGemmaEmbeddingProvider.prepareDocument(
			'A container view',
			'NavigationStack',
		),
		'title: NavigationStack | text: A container view',
	);
	assert.equal(
		LocalGemmaEmbeddingProvider.prepareDocument('Standalone text'),
		'title: none | text: Standalone text',
	);
	assert.equal(
		LocalGemmaEmbeddingProvider.prepareDocument('Standalone text', ''),
		'title: none | text: Standalone text',
	);
	assert.equal(
		LocalGemmaEmbeddingProvider.prepareDocument(
			'title: UIKit | text: Legacy views.',
		),
		'title: UIKit | text: Legacy views.',
	);
});

test('LocalGemmaEmbeddingProvider returns null for empty or unavailable inputs', async () => {
	const provider = new LocalGemmaEmbeddingProvider('/non/existent/model.gguf');
	assert.equal(await provider.embedQuery(''), null);
	assert.equal(await provider.embedQuery('   '), null);
	assert.equal(await provider.embedDocument(''), null);
	assert.equal(await provider.embedDocument('   '), null);
	// Unavailable provider returns null without throwing
	assert.equal(await provider.embedQuery('valid query'), null);
	assert.equal(await provider.embedDocument('valid content'), null);
});

test('LocalGemmaEmbeddingProvider live embedding test if model exists', async (t) => {
	const modelPath =
		'/Users/andrew/Documents/GitHub/Models/embeddinggemma-2-Q8_0.gguf';
	if (!existsSync(modelPath)) {
		t.skip('Local model not present at path');
		return;
	}

	const provider = new LocalGemmaEmbeddingProvider(modelPath);
	assert.equal(provider.isAvailable(), true);

	const queryVec = await provider.embedQuery('NavigationSplitView');
	assert.ok(queryVec instanceof Float32Array);
	assert.equal(queryVec.length, 768);

	// Check L2 norm is ~1.0
	let sum = 0;
	for (let i = 0; i < queryVec.length; i++) sum += queryVec[i] * queryVec[i];
	const norm = Math.sqrt(sum);
	assert.ok(Math.abs(norm - 1.0) < 1e-4);

	const docVec = await provider.embedDocument(
		'A multi-column navigation view',
		'NavigationSplitView',
	);
	assert.ok(docVec instanceof Float32Array);
	assert.equal(docVec.length, 768);
});
