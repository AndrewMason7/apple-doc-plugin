import assert from 'node:assert';
import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	AppleDocsDB,
	MIN_SEMANTIC_ITEMS_FOR_HYBRID,
} from '../../dist/server/db/database.js';
import {
	formatDoctorReport,
	runDoctor,
} from '../../dist/server/services/doctor.js';
import { logger } from '../../dist/server/logger.js';

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
	'logging_config',
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
	// The old next step was `export GEMINI_API_KEY=*** && npm run embed-index`,
	// which set the literal key `***`. Name both the file and the command.
	assert.match(provider.nextStep, /GEMINI_API_KEY/);
	assert.match(provider.nextStep, /\.env/);
	assert.match(provider.nextStep, /npm run embed-index$/);
	assert.doesNotMatch(provider.nextStep, /=\*/);
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

// Red first: a healthy in-memory index used to report `database_file: fail`
// because the probe gated on existsSync(':memory:').
test('an in-memory database is present, not a missing file', () => {
	const db = new AppleDocsDB(':memory:');
	addSymbol(db, 0);

	const report = runDoctor({
		db,
		dbPath: ':memory:',
		nodeVersion: 'v22.0.0',
		provider: { ...BASE_PROVIDER },
	});
	const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));

	assert.deepStrictEqual(idList(report), ALL_CHECK_IDS);
	assert.strictEqual(
		byId['database_file'].status,
		'ok',
		'a virtual path has no file to stat but is still present',
	);
	assert.strictEqual(byId['database_file'].detail, 'in-memory database');
	assert.strictEqual(
		report.ok,
		true,
		'a healthy in-memory index must not fail',
	);
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
	// Portable hint: this plugin ships to Linux as well as macOS.
	assert.match(node.nextStep, /22/);
	assert.match(node.nextStep, /brew install node/);
	assert.match(node.nextStep, /nvm install 22|apt|dnf|winget/);

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

test('a snapshot older than the 30-day threshold warns and points at build:index', () => {
	const ctx = makeContext();
	addSymbol(ctx.db, 0);
	ctx.db.setMeta(
		'built_at',
		new Date(Date.now() - 40 * 86_400_000).toISOString(),
	);

	const report = runDoctor(ctx);
	const check = report.checks.find((c) => c.id === 'snapshot_freshness');
	assert.strictEqual(check.status, 'warn');
	assert.match(check.detail, /^40 days old \(from build metadata\)/);
	assert.match(check.detail, /new Apple APIs may be missing/);
	assert.match(check.nextStep, /npm run build:index/);

	const rendered = formatDoctorReport(report);
	assert.match(rendered, /⚠ Snapshot age/);
	assert.match(rendered, /→ npm run build:index/);
});

test('two stored vector widths are a dimension failure, not one width plus noise', () => {
	const ctx = makeContext({
		provider: {
			...BASE_PROVIDER,
			id: 'gemini',
			dimensions: 768,
			isAvailable: () => true,
		},
	});
	addSymbol(ctx.db, 0);
	for (const [id, width] of [
		['sym-768', 768],
		['sym-3072', 3072],
	]) {
		ctx.db.insertSemanticItem({
			id,
			framework: 'SwiftUI',
			title: id,
			kind: 'struct',
			summary: 'vector',
			path: '/documentation/swiftui/type0',
			embedding: new Float32Array(width),
		});
	}

	const report = runDoctor(ctx);
	const check = report.checks.find((c) => c.id === 'dimension_consistency');
	assert.strictEqual(check.status, 'fail');
	assert.match(check.detail, /768\/3072-d/);
	assert.match(check.detail, /cosine scoring is invalid/);
	assert.match(check.nextStep, /npm run embed-index -- --force/);
	assert.strictEqual(report.ok, false);
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

// C1: better-sqlite3 opens lazily, so a file that is not SQLite constructs
// without an error and every getter swallows the failure into 0/[]. Doctor used
// to print FIVE green rows for a file that is not a database at all.
test('a non-SQLite index fails every dependent check instead of greening zeros', () => {
	const corrupt = path.join(TEMP_DIR, 'corrupt-apple-docs.db');
	fs.writeFileSync(corrupt, 'not a sqlite db');
	// Exactly what doctor-cli.ts does: readonly, and it does NOT throw here.
	const db = new AppleDocsDB(corrupt, { readonly: true });

	const report = runDoctor({
		db,
		dbPath: corrupt,
		nodeVersion: 'v22.0.0',
		provider: { ...BASE_PROVIDER },
	});

	assert.deepStrictEqual(idList(report), ALL_CHECK_IDS);
	assert.strictEqual(report.ok, false);

	const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
	assert.strictEqual(
		byId['database_file'].status,
		'ok',
		'the file does exist; readability is a separate check',
	);

	for (const id of ALL_CHECK_IDS.slice(2)) {
		assert.strictEqual(
			byId[id].status,
			'fail',
			`${id} must fail when the file is not a database`,
		);
		assert.match(byId[id].nextStep, /npm run build:index/);
	}

	for (const id of [
		'database_readable',
		'fts_index',
		'kind_integrity',
		'attribution_integrity',
		'dimension_consistency',
	]) {
		assert.match(
			byId[id].detail,
			/unreadable or corrupt/,
			`${id} must say the index is unreadable`,
		);
		assert.doesNotMatch(
			byId[id].detail,
			/\bempty\b/,
			`${id} must not report an unreadable index as merely empty`,
		);
	}
	assert.match(
		byId['database_readable'].detail,
		/not a database/,
		'the SQLite error must survive into the report',
	);

	// The bug was five greens: no ok row may survive downstream of the canary.
	const rendered = formatDoctorReport(report).split('\n');
	for (const title of [
		'Symbols',
		'FTS index',
		'Symbol kinds',
		'Framework attribution',
		'Vector dimensions',
	]) {
		assert.ok(
			!rendered.some((line) => line.startsWith(`✔ ${title}`)),
			`${title} must not be green for an unreadable index`,
		);
	}
	assert.doesNotMatch(rendered.join('\n'), /All checks passed/);
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

test('runDoctor: includes logging_config check without mutating report structure', () => {
	const ring = logger.getRingBuffer();
	ring.clear();
	const ctx = makeContext();
	addSymbol(ctx.db, 0);

	const report = runDoctor(ctx);
	const loggingCheck = report.checks.find((c) => c.id === 'logging_config');
	assert.ok(loggingCheck, 'Doctor report must include logging_config check');
	assert.strictEqual(loggingCheck.title, 'Logging configuration');
	assert.strictEqual(typeof loggingCheck.status, 'string');
	assert.strictEqual(loggingCheck.status, 'ok');
	assert.match(loggingCheck.detail, /level: \w+, ring buffer: \d+\/\d+/);
});

test('runDoctor: reports warn on logging_config when diagnostic buffer contains error entries', () => {
	const ctx = makeContext();
	addSymbol(ctx.db, 0);

	const ring = logger.getRingBuffer();
	ring.clear();
	try {
		ring.push({
			timestamp: new Date().toISOString(),
			level: 'error',
			message: 'simulated failure in diagnostic buffer',
		});
		const report = runDoctor(ctx);
		const loggingCheck = report.checks.find((c) => c.id === 'logging_config');
		assert.ok(loggingCheck, 'Doctor report must include logging_config check');
		assert.strictEqual(loggingCheck.status, 'warn');
		assert.match(loggingCheck.detail, /recent error\(s\) in diagnostic buffer/);
	} finally {
		ring.clear();
	}
});
