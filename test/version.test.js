import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import {
	buildVersionHandler,
	getIndexMetadata,
} from '../dist/server/handlers/version.js';

test('getIndexMetadata returns real database counts and required keys for shipped db', () => {
	const db = new AppleDocsDB('./data/apple-docs.db', { readonly: true });
	const meta = getIndexMetadata({ db, client: {}, state: {} });

	assert.ok(meta.version);
	assert.ok(meta.serverName);
	assert.ok(meta.dbPath.includes('apple-docs.db'));
	assert.strictEqual(typeof meta.symbolCount, 'number');
	// Shipped database has ~65,787 symbols; assert real count, not hardcoded "100000+"
	assert.ok(meta.symbolCount > 60000 && meta.symbolCount < 80000);
	assert.ok(Array.isArray(meta.indexedFrameworks));
	assert.ok(meta.indexedFrameworks.includes('SwiftUI'));
	assert.ok(meta.indexedFrameworks.includes('UIKit'));
	assert.ok(typeof meta.embeddingsPresent, 'boolean');
	assert.ok(meta.builtAt);

	db.close();
});

test('buildVersionHandler formats runtime metadata text without throwing', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/button',
		framework: 'SwiftUI',
		title: 'Button',
		kind: 'struct',
		abstract: 'A button.',
		path: '/documentation/swiftui/button',
		platforms: ['iOS'],
	});
	db.setMeta('built_at', '2026-09-24T10:00:00.000Z');

	const handler = buildVersionHandler({
		db,
		client: {},
		state: {},
	});
	const res = await handler();
	const text = res.content[0].text;

	assert.ok(text.includes('Indexed Symbols: 1'));
	assert.ok(text.includes('Snapshot Built At: 2026-09-24T10:00:00.000Z'));
	assert.ok(text.includes('SwiftUI'));
	assert.ok(text.includes('Database Path: :memory:'));

	db.close();
});
