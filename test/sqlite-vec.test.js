import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';

test('sqlite-vec: AppleDocsDB detects extension and reports isVecAccelerated', () => {
	const dir = mkdtempSync(join(tmpdir(), 'vec-accel-'));
	const dbPath = join(dir, 'test-vec.db');

	try {
		const db = new AppleDocsDB(dbPath);
		// In this environment, sqlite-vec is installed, so isVecAccelerated should be true
		assert.strictEqual(typeof db.isVecAccelerated(), 'boolean');
		assert.strictEqual(db.isVecAccelerated(), true);
		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('sqlite-vec: inserts 768-d vectors into vec_items and supports queryVectorNearest', () => {
	const dir = mkdtempSync(join(tmpdir(), 'vec-query-'));
	const dbPath = join(dir, 'test-nearest.db');

	try {
		const db = new AppleDocsDB(dbPath);

		// Insert Symbol A pointing mostly along dimension 0
		const vecA = new Float32Array(768);
		vecA[0] = 1.0;
		db.insertSemanticItem({
			id: 'doc/swiftui/button',
			framework: 'SwiftUI',
			title: 'Button',
			kind: 'struct',
			summary: 'A push button control.',
			path: '/documentation/swiftui/button',
			embedding: vecA,
		});

		// Insert Symbol B pointing along dimension 1
		const vecB = new Float32Array(768);
		vecB[1] = 1.0;
		db.insertSemanticItem({
			id: 'doc/uikit/uibutton',
			framework: 'UIKit',
			title: 'UIButton',
			kind: 'class',
			summary: 'A button in UIKit.',
			path: '/documentation/uikit/uibutton',
			embedding: vecB,
		});

		// Query pointing close to Symbol A
		const queryA = new Float32Array(768);
		queryA[0] = 0.95;
		queryA[2] = 0.05;

		const nearest = db.queryVectorNearest(queryA, 5);
		assert.ok(nearest.length >= 1);
		assert.strictEqual(nearest[0].id, 'doc/swiftui/button');
		assert.strictEqual(nearest[0].title, 'Button');
		assert.ok(
			nearest[0].similarity > 0.9,
			`Expected > 0.9, got ${nearest[0].similarity}`,
		);

		// Test framework filter
		const uiKitOnly = db.queryVectorNearest(queryA, 5, 'UIKit');
		assert.strictEqual(uiKitOnly.length, 1);
		assert.strictEqual(uiKitOnly[0].id, 'doc/uikit/uibutton');

		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('sqlite-vec: queryVectorNearest returns empty array on mismatched dimensions without crashing', () => {
	const dir = mkdtempSync(join(tmpdir(), 'vec-mismatch-'));
	const dbPath = join(dir, 'test-mismatch.db');

	try {
		const db = new AppleDocsDB(dbPath);

		// Query with 128-d vector when vec_items is 768-d
		const query128 = new Float32Array(128);
		const nearest = db.queryVectorNearest(query128, 5);
		assert.deepStrictEqual(nearest, []);

		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('sqlite-vec: HybridSearchEngine uses native vector search when available', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'hybrid-vec-'));
	const dbPath = join(dir, 'test-hybrid.db');

	try {
		const db = new AppleDocsDB(dbPath);

		// Populate 105 items to exceed hybrid threshold
		for (let i = 0; i < 105; i++) {
			const vec = new Float32Array(768);
			vec[0] = 0.1 * (i % 10);
			vec[1] = 0.5;
			db.insertSemanticItem({
				id: `sym-${i}`,
				framework: 'SwiftUI',
				title: `Symbol${i}`,
				kind: 'struct',
				summary: `Summary of symbol ${i}`,
				path: `/documentation/swiftui/symbol${i}`,
				embedding: vec,
			});
		}

		// Mock embedding provider that returns 768-d vector
		const mockProvider = {
			id: 'mock-provider',
			dimensions: 768,
			minSimilarity: 0.5,
			minSimilarityPreferred: 0.4,
			isAvailable: () => true,
			embedQuery: async () => {
				const q = new Float32Array(768);
				q[0] = 0.5;
				q[1] = 0.5;
				return q;
			},
			embedDocument: async () => null,
		};

		const engine = new HybridSearchEngine(db, {
			embeddingProvider: mockProvider,
		});

		const qVec = new Float32Array(768);
		qVec[0] = 0.5;
		qVec[1] = 0.5;

		const matches = engine.searchSemanticWithVector(qVec, 'SwiftUI', 5, 0.4);
		assert.ok(matches.length > 0);
		assert.ok(matches[0].similarity >= 0.4);

		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('sqlite-vec: updating vector of existing ID does not crash with UNIQUE constraint error', () => {
	const dir = mkdtempSync(join(tmpdir(), 'vec-update-'));
	const dbPath = join(dir, 'test-update.db');

	try {
		const db = new AppleDocsDB(dbPath);

		const vec1 = new Float32Array(768);
		vec1[0] = 1.0;
		db.insertSemanticItem({
			id: 'doc/swiftui/text',
			framework: 'SwiftUI',
			title: 'Text',
			kind: 'struct',
			summary: 'Initial text.',
			path: '/documentation/swiftui/text',
			embedding: vec1,
		});

		// Now update with a new vector pointing in a different direction
		const vec2 = new Float32Array(768);
		vec2[1] = 1.0;
		assert.doesNotThrow(() => {
			db.insertSemanticItem({
				id: 'doc/swiftui/text',
				framework: 'SwiftUI',
				title: 'Text',
				kind: 'struct',
				summary: 'Updated text.',
				path: '/documentation/swiftui/text',
				embedding: vec2,
			});
		});

		// Query for vec2: similarity should now be ~1.0
		const nearest = db.queryVectorNearest(vec2, 5);
		assert.strictEqual(nearest.length, 1);
		assert.strictEqual(nearest[0].id, 'doc/swiftui/text');
		assert.ok(nearest[0].similarity > 0.99);

		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('sqlite-vec: importVectorsFromDb syncs new and updated vectors without UNIQUE constraint failure', () => {
	const dir = mkdtempSync(join(tmpdir(), 'vec-import-sync-'));
	const srcPath = join(dir, 'src.db');
	const dstPath = join(dir, 'dst.db');

	try {
		const vecA = new Float32Array(768);
		vecA[0] = 1.0;
		const vecB = new Float32Array(768);
		vecB[1] = 1.0;
		const vecC = new Float32Array(768);
		vecC[2] = 1.0;

		// Source has doc1 (updated) and doc3 (new)
		const srcDb = new AppleDocsDB(srcPath);
		srcDb.insertSemanticItem({
			id: 'doc1',
			framework: 'SwiftUI',
			title: 'Doc1 Updated',
			kind: 'struct',
			summary: 'Updated',
			path: '/doc1',
			embedding: vecA,
		});
		srcDb.insertSemanticItem({
			id: 'doc3',
			framework: 'SwiftUI',
			title: 'Doc3 New',
			kind: 'struct',
			summary: 'New',
			path: '/doc3',
			embedding: vecC,
		});
		srcDb.close();

		// Destination has doc1 (old) and doc2
		const dstDb = new AppleDocsDB(dstPath);
		dstDb.insertSemanticItem({
			id: 'doc1',
			framework: 'SwiftUI',
			title: 'Doc1 Old',
			kind: 'struct',
			summary: 'Old',
			path: '/doc1',
			embedding: vecB,
		});
		dstDb.insertSemanticItem({
			id: 'doc2',
			framework: 'SwiftUI',
			title: 'Doc2',
			kind: 'struct',
			summary: 'Doc2',
			path: '/doc2',
			embedding: vecB,
		});

		// Import should update doc1 and add doc3 without error
		assert.doesNotThrow(() => {
			const imported = dstDb.importVectorsFromDb(srcPath);
			assert.strictEqual(imported, 2);
		});

		// Check all 3 items exist in vec_items
		const nearestA = dstDb.queryVectorNearest(vecA, 5);
		assert.ok(nearestA.some((item) => item.id === 'doc1'));

		const nearestC = dstDb.queryVectorNearest(vecC, 5);
		assert.ok(nearestC.some((item) => item.id === 'doc3'));

		dstDb.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('sqlite-vec: automatically synchronizes vec_items when opening DB with existing semantic_items', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'vec-autosync-'));
	const dbPath = join(dir, 'existing.db');

	try {
		// Populate database using raw better-sqlite3 without vec_items
		const { createRequire } = await import('node:module');
		const require = createRequire(import.meta.url);
		const BetterSqlite = require('better-sqlite3');
		const raw = new BetterSqlite(dbPath);
		raw.exec(`
			CREATE TABLE semantic_items (
				id TEXT PRIMARY KEY,
				framework TEXT NOT NULL,
				title TEXT NOT NULL,
				kind TEXT NOT NULL,
				summary TEXT NOT NULL,
				path TEXT NOT NULL,
				media_url TEXT,
				media_type TEXT,
				embedding BLOB NOT NULL
			);
		`);
		const vec = new Float32Array(768);
		vec[0] = 0.99;
		raw
			.prepare('INSERT INTO semantic_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
			.run(
				'legacy/sym',
				'SwiftUI',
				'LegacySymbol',
				'struct',
				'Legacy abstract',
				'/documentation/swiftui/legacy',
				null,
				null,
				Buffer.from(vec.buffer),
			);
		raw.close();

		// Opening with AppleDocsDB should automatically sync vec_items
		const docsDb = new AppleDocsDB(dbPath);
		assert.strictEqual(docsDb.getSemanticItemCount(), 1);

		const nearest = docsDb.queryVectorNearest(vec, 5);
		assert.strictEqual(nearest.length, 1);
		assert.strictEqual(nearest[0].id, 'legacy/sym');
		assert.strictEqual(nearest[0].title, 'LegacySymbol');

		docsDb.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
