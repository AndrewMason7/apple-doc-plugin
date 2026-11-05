import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AppleDocsDB } from '../dist/server/db/database.js';

const makeDb = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-doctor-'));
	return new AppleDocsDB(path.join(dir, 'test.db'));
};

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

test('getFtsCount matches the symbol count after inserts', () => {
	const db = makeDb();
	for (let i = 0; i < 3; i++) addSymbol(db, i);

	assert.strictEqual(db.getSymbolCount(), 3);
	assert.strictEqual(db.getFtsCount(), 3);
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
