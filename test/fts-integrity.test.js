import assert from 'node:assert';
import test from 'node:test';
import {
	AppleDocsDB,
	deserializeFloat32Array,
} from '../dist/server/db/database.js';

test('FTS Integrity: updating a symbol preserves non-empty abstract', () => {
	const db = new AppleDocsDB(':memory:');

	// 1. Initial insert with rich abstract
	db.insertSymbol({
		id: 'documentation/swiftui/griditem',
		framework: 'SwiftUI',
		title: 'GridItem',
		kind: 'struct',
		abstract: 'A description of an item organized within a grid layout.',
		path: '/documentation/swiftui/griditem',
		platforms: ['iOS 14.0+'],
	});

	// 2. Second insert with an empty abstract and an empty platform list.
	db.insertSymbol({
		id: 'documentation/swiftui/griditem',
		framework: 'SwiftUI',
		title: 'GridItem',
		kind: 'struct',
		abstract: '',
		path: '/documentation/swiftui/griditem',
		platforms: [],
	});

	// Abstract must NOT be wiped out
	const sym = db.getSymbolByPath('/documentation/swiftui/griditem');
	assert(sym !== null);
	assert.strictEqual(
		sym.abstract,
		'A description of an item organized within a grid layout.',
		'Non-empty abstract must be preserved on update',
	);

	const rowAfterUpdate = db['db']
		.prepare('SELECT rowid, abstract, platforms FROM symbols WHERE id = ?')
		.get('documentation/swiftui/griditem');
	assert.strictEqual(
		rowAfterUpdate.rowid,
		1,
		'Upsert must keep the original rowid',
	);
	assert.strictEqual(
		rowAfterUpdate.abstract,
		'A description of an item organized within a grid layout.',
	);
	assert.strictEqual(
		rowAfterUpdate.platforms,
		'["iOS 14.0+"]',
		'An empty platform list must not wipe a previous platform list',
	);

	// A later non-empty platform list replaces the stored one and still keeps the abstract.
	db.insertSymbol({
		id: 'documentation/swiftui/griditem',
		framework: 'SwiftUI',
		title: 'GridItem',
		kind: 'struct',
		abstract: '',
		path: '/documentation/swiftui/griditem',
		platforms: ['macOS'],
	});
	const rowAfterPlatform = db['db']
		.prepare('SELECT rowid, abstract, platforms FROM symbols WHERE id = ?')
		.get('documentation/swiftui/griditem');
	assert.strictEqual(rowAfterPlatform.rowid, 1);
	assert.strictEqual(rowAfterPlatform.platforms, '["macOS"]');
	assert.strictEqual(
		rowAfterPlatform.abstract,
		'A description of an item organized within a grid layout.',
	);

	// Direct FTS MATCH must succeed after repeated upserts. A broken external-content
	// index throws "missing row from content table" here.
	const direct = db['db']
		.prepare("SELECT title FROM symbols_fts WHERE symbols_fts MATCH 'GridItem'")
		.all();
	assert.deepStrictEqual(direct, [{ title: 'GridItem' }]);

	const ftsMatch = db.queryFTS('GridItem');
	assert.strictEqual(ftsMatch.length, 1);
	assert.strictEqual(ftsMatch[0].title, 'GridItem');
	assert.strictEqual(
		ftsMatch[0].abstract,
		'A description of an item organized within a grid layout.',
	);
	assert.deepStrictEqual(ftsMatch[0].platforms, ['macOS']);

	db.rebuildFTS();
	const afterRebuild = db['db']
		.prepare("SELECT title FROM symbols_fts WHERE symbols_fts MATCH 'GridItem'")
		.all();
	assert.deepStrictEqual(afterRebuild, [{ title: 'GridItem' }]);

	db.close();
});

test('deserializeFloat32Array rejects buffers whose byteLength is not a multiple of 4', () => {
	const corruptBuf = Buffer.from([1, 2, 3]); // byteLength is 3, not divisible by 4
	const result = deserializeFloat32Array(corruptBuf);
	assert.strictEqual(result, null, 'Should return null on invalid byteLength');
});
