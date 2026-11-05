import assert from 'node:assert';
import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	AppleDocsDB,
	MIN_SEMANTIC_ITEMS_FOR_HYBRID,
} from '../dist/server/db/database.js';
import {
	formatDoctorReport,
	runDoctor,
} from '../dist/server/services/doctor.js';

const ALL_CHECK_IDS = [
	'node_version',
	'database_file',
	'database_readable',
	'fts_index',
	'kind_integrity',
	'attribution_integrity',
	'provider_available',
	'semantic_layer',
	'dimension_consistency',
	'snapshot_freshness',
];

// One temp root for the whole file, removed once every test has run.
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-doctor-'));
after(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));

let dbCounter = 0;

const BASE_PROVIDER = {
	id: 'unavailable',
	dimensions: 0,
	isAvailable: () => false,
	embedQuery: async () => null,
	embedDocument: async () => null,
};

const makeContext = (overrides = {}) => {
	const db = new AppleDocsDB(path.join(TEMP_DIR, `test-${dbCounter++}.db`));
	return {
		db,
		dbPath: db.dbPath,
		nodeVersion: 'v22.0.0',
		provider: { ...BASE_PROVIDER },
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

const idList = (report) => report.checks.map((c) => c.id);

test('a healthy single-symbol index reports all ten checks ok', () => {
	const ctx = makeContext();
	addSymbol(ctx.db, 0);

	const report = runDoctor(ctx);
	assert.strictEqual(report.ok, true, 'warns are not failures');
	assert.deepStrictEqual(idList(report), ALL_CHECK_IDS);

	const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
	assert.strictEqual(byId['node_version'].status, 'ok');
	assert.strictEqual(byId['database_file'].status, 'ok');
	assert.strictEqual(byId['database_readable'].status, 'ok');
	assert.strictEqual(byId['fts_index'].status, 'ok');
	assert.strictEqual(byId['kind_integrity'].status, 'ok');
	assert.strictEqual(byId['attribution_integrity'].status, 'ok');
	assert.match(
		byId['database_file'].detail,
		/\d KB\)$/,
		'sub-megabyte indexes must not render as 0 MB',
	);
});

test('an unavailable provider is a warning that names a runnable command', () => {
	const ctx = makeContext();
	addSymbol(ctx.db, 0);

	const provider = runDoctor(ctx).checks.find(
		(c) => c.id === 'provider_available',
	);
	assert.strictEqual(provider.status, 'warn');
	assert.match(
		provider.nextStep,
		/^export GEMINI_API_KEY=\S+ && npm run embed-index$/,
	);
});

test('vectors below the hybrid threshold warn and point at embed-index', () => {
	const ctx = makeContext({
		provider: {
			...BASE_PROVIDER,
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
			...BASE_PROVIDER,
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

test('a missing database file still yields all ten checks', () => {
	const ctx = makeContext({ dbPath: '/nonexistent/apple-docs.db' });

	const report = runDoctor(ctx);
	const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));

	assert.deepStrictEqual(idList(report), ALL_CHECK_IDS);
	assert.strictEqual(byId['database_file'].status, 'fail');
	assert.match(byId['database_file'].nextStep, /npm run build:index/);

	for (const id of ALL_CHECK_IDS.slice(2)) {
		assert.strictEqual(
			byId[id].status,
			'warn',
			`${id} must be skipped, not missing`,
		);
		assert.match(byId[id].detail, /skipped — no readable index/);
		assert.match(byId[id].nextStep, /npm run build:index/);
	}
});

test('broken inputs yield a report instead of an exception', () => {
	const ctx = makeContext();
	addSymbol(ctx.db, 0);

	const throwingProvider = {
		...BASE_PROVIDER,
		id: 'exploding',
		isAvailable: () => {
			throw new Error('provider exploded');
		},
	};
	const providerReport = runDoctor({ ...ctx, provider: throwingProvider });
	assert.deepStrictEqual(idList(providerReport), ALL_CHECK_IDS);
	const provider = providerReport.checks.find(
		(c) => c.id === 'provider_available',
	);
	assert.strictEqual(provider.status, 'fail');
	assert.match(provider.detail, /provider exploded/);

	const oldNodeReport = runDoctor({ ...ctx, nodeVersion: 'v20.11.0' });
	const node = oldNodeReport.checks.find((c) => c.id === 'node_version');
	assert.strictEqual(node.status, 'fail');
	assert.strictEqual(node.nextStep, 'brew install node');

	// A path under a regular file cannot be stat'ed: ENOTDIR.
	const unstatable = path.join(ctx.dbPath, 'nested', 'apple-docs.db');
	const brokenReport = runDoctor({ ...ctx, dbPath: unstatable });
	assert.deepStrictEqual(idList(brokenReport), ALL_CHECK_IDS);
	assert.strictEqual(brokenReport.ok, false);
	assert.strictEqual(
		brokenReport.checks.find((c) => c.id === 'database_file').status,
		'fail',
	);
});

test('a future-dated build stamp clamps to zero days and stays ok', () => {
	const ctx = makeContext();
	addSymbol(ctx.db, 0);
	ctx.db.setMeta('built_at', new Date(Date.now() + 86_400_000).toISOString());

	const check = runDoctor(ctx).checks.find(
		(c) => c.id === 'snapshot_freshness',
	);
	assert.strictEqual(check.status, 'ok');
	assert.match(check.detail, /^0 days old/);
});

test('a one-day-old snapshot reads "1 day old" and names its provenance in prose', () => {
	const ctx = makeContext();
	addSymbol(ctx.db, 0);
	// Just over 24h ago: floor() lands on exactly one day.
	ctx.db.setMeta('built_at', new Date(Date.now() - 90_000_000).toISOString());

	const check = runDoctor(ctx).checks.find(
		(c) => c.id === 'snapshot_freshness',
	);
	assert.strictEqual(check.status, 'ok');
	assert.match(check.detail, /^1 day old \(from build metadata\)$/);
	assert.doesNotMatch(check.detail, /1 days/);

	// No build stamp: the file mtime fallback must be named in words, not as
	// the internal 'db-file-mtime' enum.
	const fallbackCtx = makeContext();
	addSymbol(fallbackCtx.db, 0);
	const fallback = runDoctor(fallbackCtx).checks.find(
		(c) => c.id === 'snapshot_freshness',
	);
	assert.match(fallback.detail, /\(from the index file timestamp\)$/);
	assert.doesNotMatch(fallback.detail, /db-file-mtime/);
});

test('a present but unopenable index is a failure, never a pass', () => {
	const ctx = makeContext({ db: undefined });
	const decoy = path.join(TEMP_DIR, 'decoy-apple-docs.db');
	fs.writeFileSync(decoy, 'this is not a sqlite database');

	const report = runDoctor({ ...ctx, dbPath: decoy });

	assert.strictEqual(report.ok, false, 'an unreadable index must fail');
	assert.deepStrictEqual(idList(report), ALL_CHECK_IDS);

	const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
	assert.strictEqual(byId['database_file'].status, 'ok');

	for (const id of ALL_CHECK_IDS.slice(2)) {
		assert.strictEqual(
			byId[id].status,
			'fail',
			`${id} must fail when the index exists but cannot be opened`,
		);
		assert.match(byId[id].detail, /could not be opened/);
		assert.match(byId[id].nextStep, /npm run build:index/);
	}
	assert.doesNotMatch(
		JSON.stringify(report),
		/skipped — no readable index/,
		'skipped rows are only for a genuinely absent file',
	);
});

test('formatDoctorReport marks every check and prints next steps only when needed', () => {
	const report = {
		ok: false,
		failures: 1,
		warnings: 1,
		checks: [
			{
				id: 'node_version',
				title: 'Node.js',
				status: 'ok',
				detail: 'v22.0.0',
				nextStep: '',
			},
			{
				id: 'semantic_layer',
				title: 'Semantic layer',
				status: 'warn',
				detail: '12/100 vectors',
				nextStep: 'npm run embed-index',
			},
			{
				id: 'fts_index',
				title: 'FTS index',
				status: 'fail',
				detail: '0 vs 65787',
				nextStep: 'npm run build:index',
			},
		],
	};

	const text = formatDoctorReport(report);
	assert.match(text, /✔ Node\.js/);
	assert.match(text, /⚠ Semantic layer/);
	assert.match(text, /✖ FTS index/);
	assert.match(text, /→ npm run build:index/);

	// The contract is 'next steps only when needed' — assert the ABSENCE too,
	// otherwise an implementation that prints an empty arrow for every row passes.
	const arrows = text.split('\n').filter((line) => line.trim().startsWith('→'));
	assert.strictEqual(
		arrows.length,
		2,
		'only the warn and the fail carry a next step',
	);
	assert.doesNotMatch(text, /^\s*→\s*$/m, 'no empty arrow lines');

	// Singular and plural must both be right.
	assert.match(text, /1 failure, 1 warning\./);

	const plural = formatDoctorReport({
		ok: false,
		failures: 2,
		warnings: 0,
		checks: [
			{
				id: 'a',
				title: 'A',
				status: 'fail',
				detail: 'x',
				nextStep: 'npm run build:index',
			},
			{ id: 'b', title: 'B', status: 'fail', detail: 'y', nextStep: '' },
		],
	});
	assert.match(plural, /2 failures, 0 warnings\./);

	// A whitespace-only next step is not a next step: no blank arrow line.
	const blank = formatDoctorReport({
		ok: true,
		failures: 0,
		warnings: 0,
		checks: [
			{ id: 'a', title: 'A', status: 'ok', detail: 'x', nextStep: '   ' },
		],
	});
	assert.doesNotMatch(
		blank,
		/→/,
		'a whitespace-only next step must not render an arrow',
	);
	assert.match(blank, /All checks passed\./);

	// The summary must follow the failure count, not a stale or hand-built ok flag.
	const inconsistent = formatDoctorReport({
		ok: true,
		failures: 2,
		warnings: 0,
		checks: [
			{ id: 'a', title: 'A', status: 'fail', detail: 'x', nextStep: '' },
			{ id: 'b', title: 'B', status: 'fail', detail: 'y', nextStep: '' },
		],
	});
	assert.match(
		inconsistent,
		/2 failures, 0 warnings\./,
		'failures must win over a contradictory ok flag',
	);
});
