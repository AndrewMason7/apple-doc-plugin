import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AppleDocsDB } from '../dist/server/db/database.js';
import { embedSymbols } from '../dist/server/services/symbol-embeddings.js';

const makeDb = (count = 250) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-batch-'));
	const db = new AppleDocsDB(path.join(dir, 'test.db'));
	for (let i = 0; i < count; i++) {
		db.insertSymbol({
			id: `/documentation/swiftui/type${i}`,
			framework: 'SwiftUI',
			title: `Type${i}`,
			kind: 'struct',
			abstract: `Type ${i} does something.`,
			path: `/documentation/swiftui/type${i}`,
			platforms: ['iOS'],
			isPrimaryType: true,
		});
	}
	return db;
};

const vectorFor = (text, dims = 8) => {
	const v = new Float32Array(dims);
	for (let i = 0; i < dims; i++) v[i] = ((text.charCodeAt(i % text.length) + i) % 13) / 13;
	return v;
};

/** Provider that advertises batching, records chunk sizes and per-item calls. */
const batchingProvider = (overrides = {}) => ({
	id: 'gemini',
	dimensions: 8,
	batchSizes: [],
	singleCalls: 0,
	isAvailable: () => true,
	embedQuery: async () => null,
	embedDocument: async function (content) {
		this.singleCalls++;
		return vectorFor(content);
	},
	embedDocuments: async function (items) {
		this.batchSizes.push(items.length);
		return items.map((item, index) =>
			overrides.dropIndex === index ? null : vectorFor(`${item.title}:${item.content}`),
		);
	},
});

test('embedSymbols uses the provider batch API instead of one request per symbol', async () => {
	const db = makeDb(250);
	const provider = batchingProvider();

	const result = await embedSymbols(db, provider, {});

	assert.strictEqual(result.embedded, 250);
	assert.strictEqual(provider.singleCalls, 0, 'no per-item calls when batching works');
	assert.deepStrictEqual(
		provider.batchSizes,
		[100, 100, 50],
		'chunks must respect the 100-item batch ceiling and cover every symbol once',
	);
	assert.strictEqual(db.getSemanticItemCount(), 250);
});

test('a null inside a batch falls back to a per-item request for that symbol only', async () => {
	const db = makeDb(6);
	const provider = batchingProvider({ dropIndex: 2 });

	const result = await embedSymbols(db, provider, {});

	assert.strictEqual(result.embedded, 6, 'the failed slot is retried individually');
	assert.strictEqual(provider.singleCalls, 1, 'exactly one per-item fallback');
	assert.strictEqual(result.failed, 0);
	assert.strictEqual(db.getSemanticItemCount(), 6);
});

test('a provider without embedDocuments still embeds one at a time', async () => {
	const db = makeDb(5);
	const provider = {
		id: 'local-gguf',
		dimensions: 8,
		singleCalls: 0,
		isAvailable: () => true,
		embedQuery: async () => null,
		embedDocument: async function (content) {
			this.singleCalls++;
			return vectorFor(content);
		},
	};

	const result = await embedSymbols(db, provider, {});

	assert.strictEqual(result.embedded, 5);
	assert.strictEqual(provider.singleCalls, 5);
	assert.strictEqual(db.getSemanticItemCount(), 5);
});

test('batching keeps ids and metadata aligned with the right symbol', async () => {
	const db = makeDb(3);
	const provider = batchingProvider();

	await embedSymbols(db, provider, {});

	const items = db.getSemanticItems();
	const byId = new Map(items.map((item) => [item.id, item]));
	assert.strictEqual(byId.size, 3);
	for (let i = 0; i < 3; i++) {
		const item = byId.get(`sym-/documentation/swiftui/type${i}`);
		assert.ok(item, `missing vector for type${i}`);
		assert.strictEqual(item.title, `Type${i}`, 'title must follow the symbol, not the batch order');
		assert.strictEqual(item.dimensions ?? item.embedding.length, 8);
	}
});
