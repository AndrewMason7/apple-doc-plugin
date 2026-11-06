import assert from 'node:assert';
import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { AppleDocsDB } from '../../dist/server/db/database.js';

const dirs = [];
const makeDb = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-doctor-'));
	dirs.push(dir);
	return new AppleDocsDB(path.join(dir, 'test.db'));
};

after(() =>
	dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })),
);

const addSymbol = (db, i) =>
	db.insertSymbol({
		id: `/documentation/swiftui/type${i}`,
		framework: 'SwiftUI',
		title: `Type${i}`,
		kind: 'struct',
		abstract: `Type ${i}.`,
		path: `/documentation/swiftui/type${i}`,
		platforms: ['iOS'],
		isPrimaryType: true,
	});

test('getFtsCount reports the index doc count, which diverges when the index is stale', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-doctor-'));
	dirs.push(dir);
	const file = path.join(dir, 'test.db');

	const db = new AppleDocsDB(file);
	for (let i = 0; i < 3; i++) addSymbol(db, i);
	db.close();

	// Make the index stale on purpose: drop the insert trigger, then insert.
	// The drop must come *after* the reopen — the constructor runs SCHEMA_SQL,
	// whose `CREATE TRIGGER IF NOT EXISTS symbols_ai` would silently undo it.
	const reopened = new AppleDocsDB(file);
	const raw = new Database(file);
	raw.prepare('DROP TRIGGER symbols_ai').run();
	raw.close();

	addSymbol(reopened, 3);

	assert.strictEqual(reopened.getSymbolCount(), 4);
	assert.strictEqual(reopened.getFtsCount(), 3, 'stale index must be visible');
	reopened.close();
});

test('getFtsCount and getVectorDimensions return safe defaults after close', () => {
	const db = makeDb();
	addSymbol(db, 0);
	db.close();

	assert.strictEqual(db.getFtsCount(), 0);
	assert.deepStrictEqual(db.getVectorDimensions(), []);
});

test('getVectorDimensions reports the distinct stored widths', () => {
	const db = makeDb();
	assert.deepStrictEqual(db.getVectorDimensions(), []);

	addSymbol(db, 0);
	db.insertSemanticItem({
		id: 'sym-1',
		framework: 'SwiftUI',
		title: 'Type0',
		kind: 'struct',
		summary: 'Type 0.',
		path: '/documentation/swiftui/type0',
		embedding: new Float32Array(768),
	});
	assert.deepStrictEqual(db.getVectorDimensions(), [768]);
});
