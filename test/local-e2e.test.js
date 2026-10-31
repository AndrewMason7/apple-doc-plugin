import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { LocalGemmaEmbeddingProvider } from '../dist/server/services/search/local-gemma-provider.js';

test('End-to-End: in-process local EmbeddingGemma 2 semantic search', async (t) => {
	const modelPath =
		'/Users/andrew/Documents/GitHub/Models/embeddinggemma-2-Q8_0.gguf';
	if (!existsSync(modelPath)) {
		t.skip('Local GGUF model not found at path');
		return;
	}

	const provider = new LocalGemmaEmbeddingProvider(modelPath);
	assert.equal(provider.isAvailable(), true);

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

	// Embed document using real in-process model
	const docVec = await provider.embedDocument(
		'A view that presents views in two or three columns.',
		'NavigationSplitView',
	);
	assert.ok(docVec instanceof Float32Array);
	assert.equal(docVec.length, 768);

	db.insertSemanticItem({
		id: 'documentation/swiftui/navigationsplitview',
		framework: 'SwiftUI',
		title: 'NavigationSplitView',
		kind: 'struct',
		summary: 'A view that presents views in two or three columns.',
		path: '/documentation/swiftui/navigationsplitview',
		embedding: docVec,
	});

	const engine = new HybridSearchEngine(db, {
		embeddingProvider: provider,
		minSemanticItems: 1,
	});

	const results = await engine.search('multi column layout views', {
		preferSemantic: true,
	});
	assert.ok(Array.isArray(results));
	assert.ok(results.length > 0);
	assert.equal(results[0].title, 'NavigationSplitView');
	assert.ok(results[0].source === 'semantic' || results[0].source === 'hybrid');

	db.close();
});
