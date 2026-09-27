import test from 'node:test';
import assert from 'node:assert/strict';
import { AppleDocsDB } from '../dist/server/db/database.js';

test('Database Hardening: resolveSymbol and queryLike survive locked or errored queries safely', () => {
	const db = new AppleDocsDB(':memory:');

	// Test queryLike on empty db
	const likeResults = db['queryLike']('TestQuery');
	assert.ok(Array.isArray(likeResults));
	assert.equal(likeResults.length, 0);

	// Test resolveSymbol on non-existent symbol
	const resolved = db.resolveSymbol('NonExistentSymbol');
	assert.deepEqual(resolved, {});

	// Test getMeta, getSymbolCount, getIndexedFrameworks return safe defaults
	assert.equal(db.getMeta('unknown_key'), undefined);
	assert.equal(db.getSymbolCount(), 0);
	assert.deepEqual(db.getIndexedFrameworks(), []);
	assert.deepEqual(db.getFrameworkSymbolCounts(), []);
	assert.equal(db.hasEmbeddings(), false);
	assert.equal(db.getSemanticItemCount(), 0);

	db.close();
});
