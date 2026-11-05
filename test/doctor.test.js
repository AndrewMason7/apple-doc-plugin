import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	AppleDocsDB,
	MIN_SEMANTIC_ITEMS_FOR_HYBRID,
} from '../dist/server/db/database.js';
import { runDoctor } from '../dist/server/services/doctor.js';

const makeContext = (overrides = {}) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-doctor-'));
	const db = new AppleDocsDB(path.join(dir, 'test.db'));
	return {
		db,
		dbPath: db.dbPath,
		nodeVersion: 'v22.0.0',
		provider: {
			id: 'unavailable',
			dimensions: 0,
			isAvailable: () => false,
			embedQuery: async () => null,
			embedDocument: async () => null,
		},
		...overrides,
	};
};

const addSymbol = (db, i, over = {}) =>
	db.insertSymbol({
		id: over.id ?? `/documentation/swiftui/type${i}`,
		framework: over.framework ?? 'SwiftUI',
		title: over.title ?? `Type${i}`,
		kind: over.kind ?? 'struct',
		abstract: 'x',
		path: over.path ?? `/documentation/swiftui/type${i}`,
		platforms: ['iOS'],
		isPrimaryType: true,
	});

test('a healthy empty index reports ok checks and no failures', () => {
	const ctx = makeContext();
	addSymbol(ctx.db, 0);

	const report = runDoctor(ctx);
	assert.strictEqual(report.ok, true, 'warns are not failures');

	const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
	assert.strictEqual(byId['node_version'].status, 'ok');
	assert.strictEqual(byId['database_file'].status, 'ok');
	assert.strictEqual(byId['database_readable'].status, 'ok');
	assert.strictEqual(byId['fts_index'].status, 'ok');
	assert.strictEqual(byId['kind_integrity'].status, 'ok');
	assert.strictEqual(byId['attribution_integrity'].status, 'ok');
});

test('an unavailable provider is a warning, not a failure', () => {
	const ctx = makeContext();
	addSymbol(ctx.db, 0);

	const provider = runDoctor(ctx).checks.find(
		(c) => c.id === 'provider_available',
	);
	assert.strictEqual(provider.status, 'warn');
	assert.match(provider.nextStep, /embed-index/, 'must name the exact command');
	assert.match(provider.nextStep, /APPLE_DOCS_EMBEDDING|GEMINI_API_KEY/);
});

test('vectors below the hybrid threshold warn and point at embed-index', () => {
	const ctx = makeContext({
		provider: {
			...makeContext().provider,
			id: 'gemini',
			dimensions: 768,
			isAvailable: () => true,
		},
	});
	addSymbol(ctx.db, 0);
	ctx.db.insertSemanticItem({
		id: 'sym-1',
		framework: 'SwiftUI',
		title: 'Type0',
		kind: 'struct',
		summary: 'Type 0.',
		path: '/documentation/swiftui/type0',
		embedding: new Float32Array(768),
	});

	const check = runDoctor(ctx).checks.find((c) => c.id === 'semantic_layer');
	assert.strictEqual(check.status, 'warn');
	assert.match(check.detail, new RegExp(`${MIN_SEMANTIC_ITEMS_FOR_HYBRID}`));
	assert.match(check.nextStep, /npm run embed-index/);
});

test('a vector width mismatch is a failure with the re-embed command', () => {
	const ctx = makeContext({
		provider: {
			...makeContext().provider,
			id: 'gemini',
			dimensions: 1536,
			isAvailable: () => true,
		},
	});
	addSymbol(ctx.db, 0);
	ctx.db.insertSemanticItem({
		id: 'sym-1',
		framework: 'SwiftUI',
		title: 'Type0',
		kind: 'struct',
		summary: 'Type 0.',
		path: '/documentation/swiftui/type0',
		embedding: new Float32Array(768),
	});

	const report = runDoctor(ctx);
	const check = report.checks.find((c) => c.id === 'dimension_consistency');
	assert.strictEqual(check.status, 'fail');
	assert.strictEqual(report.ok, false);
	assert.match(check.nextStep, /--force/);
});

test('a missing database file is a failure that names build:index', () => {
	const ctx = makeContext({ dbPath: '/nonexistent/apple-docs.db' });

	const check = runDoctor(ctx).checks.find((c) => c.id === 'database_file');
	assert.strictEqual(check.status, 'fail');
	assert.match(check.nextStep, /npm run build:index/);
});
