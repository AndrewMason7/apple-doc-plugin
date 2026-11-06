import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	AppleDocsDB,
	MIN_SEMANTIC_ITEMS_FOR_HYBRID,
} from '../dist/server/db/database.js';
import {
	buildVersionHandler,
	buildIndexInfoHandler,
} from '../dist/server/handlers/version.js';
import {
	resolveFrameworkFromPath,
	resolveSymbolKind,
} from '../dist/server/services/indexer.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';

const makeDb = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-truth-'));
	const db = new AppleDocsDB(path.join(dir, 'test.db'));
	// Deterministic mtime so freshness fallbacks are assertable.
	const mtime = new Date('2026-10-01T12:00:00.000Z');
	fs.utimesSync(db.dbPath, mtime, mtime);
	return { db, dir };
};

const addSymbol = (db, over = {}) =>
	db.insertSymbol({
		id: over.id ?? '/documentation/swiftui/view',
		framework: over.framework ?? 'SwiftUI',
		title: over.title ?? 'View',
		kind: over.kind ?? 'protocol',
		abstract: over.abstract ?? 'A type that represents part of your app UI.',
		path: over.path ?? '/documentation/swiftui/view',
		platforms: over.platforms ?? ['iOS', 'macOS'],
		isPrimaryType: over.isPrimaryType ?? true,
	});

const addSemantic = (db, count) => {
	for (let i = 0; i < count; i++) {
		db.insertSemanticItem({
			id: `item-${i}`,
			framework: 'SwiftUI',
			title: `item ${i}`,
			kind: 'technology',
			summary: 'summary',
			path: '/documentation/swiftui',
			embedding: new Float32Array([0.1, 0.2, 0.3, 0.4]),
		});
	}
};

const textOf = (response) => response.content.map((c) => c.text).join('\n');

// ---------------------------------------------------------------------------
// Fix A: embedding status must not claim hybrid mode when search is lexical.
// ---------------------------------------------------------------------------

test('get_version reports lexical fallback when semantic items are below the hybrid threshold', async () => {
	const { db } = makeDb();
	addSemantic(db, 24);
	addSymbol(db);

	const out = textOf(await buildVersionHandler({ db })());

	assert.ok(/Lexical/i.test(out), `expected honest lexical mode, got:\n${out}`);
	assert.ok(
		!/hybrid multimodal search enabled/i.test(out),
		'get_version must not claim hybrid mode while the search path falls back to lexical',
	);
	assert.ok(
		out.includes(String(24)) &&
			out.includes(String(MIN_SEMANTIC_ITEMS_FOR_HYBRID)),
		'get_version must show the actual semantic item count and the threshold',
	);
});

test('get_version reports hybrid mode only once the semantic index clears the threshold', async () => {
	const { db } = makeDb();
	addSemantic(db, MIN_SEMANTIC_ITEMS_FOR_HYBRID);
	addSymbol(db);

	const out = textOf(await buildVersionHandler({ db })());

	assert.ok(/Hybrid/i.test(out), `expected hybrid mode, got:\n${out}`);
});

test('getEmbeddingStatus agrees with the search path threshold', () => {
	const { db } = makeDb();
	addSemantic(db, 3);

	const status = db.getEmbeddingStatus();

	assert.strictEqual(status.semanticItemCount, 3);
	assert.strictEqual(status.threshold, MIN_SEMANTIC_ITEMS_FOR_HYBRID);
	assert.strictEqual(status.hybridEnabled, false);
	assert.strictEqual(status.mode, 'lexical-only');
});

// ---------------------------------------------------------------------------
// Fix D: freshness must never be reported as unrecorded when it is derivable.
// ---------------------------------------------------------------------------

test('get_version reports a freshness provenance instead of "Not recorded" when meta is empty', async () => {
	const { db } = makeDb();
	addSymbol(db);

	const out = textOf(await buildVersionHandler({ db })());

	assert.ok(
		!/Not recorded in snapshot/i.test(out),
		`freshness must be derivable from the db file, got:\n${out}`,
	);
	assert.ok(
		/2026-10-01/.test(out),
		`expected the db file mtime to be surfaced, got:\n${out}`,
	);
	assert.ok(
		/db file mtime/i.test(out),
		'freshness must name its provenance so a fallback is never mistaken for a build stamp',
	);
});

test('get_version prefers the recorded built_at stamp over file mtime', async () => {
	const { db } = makeDb();
	addSymbol(db);
	db.setMeta('built_at', '2026-11-01T09:30:00.000Z');

	const out = textOf(await buildVersionHandler({ db })());

	assert.ok(/2026-11-01/.test(out), `expected recorded built_at, got:\n${out}`);
	assert.ok(!/db file mtime/i.test(out));
});

// ---------------------------------------------------------------------------
// Fix A/2/3: index_info must be a distinct, diagnostic payload.
// ---------------------------------------------------------------------------

test('index_info is distinct from get_version and reports index health', async () => {
	const { db } = makeDb();
	addSymbol(db);
	addSymbol(db, {
		id: 'documentation/uikit/nsview',
		framework: 'Foundation', // deliberate attribution corruption
		title: 'NSView',
		kind: 'class',
		path: '/documentation/uikit/nsview',
	});
	addSymbol(db, {
		id: '/documentation/swiftdata/modelcontainer',
		framework: 'SwiftData',
		title: 'ModelContainer',
		kind: 'symbol',
		path: '/documentation/swiftdata/modelcontainer',
		isPrimaryType: false,
	});

	const context = { db };
	const versionOut = textOf(await buildVersionHandler(context)());
	const infoOut = textOf(await buildIndexInfoHandler(context)());

	assert.notStrictEqual(
		infoOut,
		versionOut,
		'index_info must not be a byte-identical duplicate of get_version',
	);
	assert.ok(
		/index health/i.test(infoOut),
		`expected an index health section:\n${infoOut}`,
	);
	assert.ok(
		/kind distribution/i.test(infoOut),
		`expected a kind distribution section:\n${infoOut}`,
	);
	assert.ok(
		/unknown kind/i.test(infoOut),
		'expected unknown-kind count (rows stored with a generic "symbol" kind)',
	);
	assert.ok(
		/framework.*mismatch|mismatched framework/i.test(infoOut),
		'expected framework/path mismatch count',
	);
	assert.ok(
		/\*\*Symbols:\*\* 3/i.test(infoOut),
		`expected the symbol total to appear:\n${infoOut}`,
	);
});

test('countUnknownKind and countFrameworkPathMismatches quantify the two data defects', () => {
	const { db } = makeDb();
	addSymbol(db); // correct: SwiftUI + /documentation/swiftui/view
	addSymbol(db, {
		id: 'documentation/uikit/nsview',
		framework: 'Foundation',
		title: 'NSView',
		kind: 'class',
		path: '/documentation/uikit/nsview',
	});
	addSymbol(db, {
		id: '/documentation/swiftdata/modelcontainer',
		framework: 'SwiftData',
		title: 'ModelContainer',
		kind: 'symbol',
		path: '/documentation/swiftdata/modelcontainer',
	});

	assert.strictEqual(db.countUnknownKind(), 1);
	assert.strictEqual(db.countFrameworkPathMismatches(), 1);
});

// ---------------------------------------------------------------------------
// Fix C: framework attribution from any DocC identifier shape.
// ---------------------------------------------------------------------------

test('resolveFrameworkFromPath handles doc:// identifiers, absolute, relative and bare slugs', () => {
	assert.strictEqual(
		resolveFrameworkFromPath(
			'doc://com.apple.SwiftUI/documentation/SwiftUI/AngularGradient',
			'AppKit',
		),
		'SwiftUI',
	);
	assert.strictEqual(
		resolveFrameworkFromPath(
			'doc://com.apple.documentation/documentation/uikit/nsview',
			'Foundation',
		),
		'UIKit',
	);
	assert.strictEqual(
		resolveFrameworkFromPath('/documentation/uikit/nsview', 'Foundation'),
		'UIKit',
	);
	assert.strictEqual(
		resolveFrameworkFromPath('swiftui/view', 'AppKit'),
		'SwiftUI',
	);
	assert.strictEqual(resolveFrameworkFromPath('uikit', 'Foundation'), 'UIKit');
	assert.strictEqual(resolveFrameworkFromPath('swift', 'SwiftUI'), 'Swift');
	assert.strictEqual(
		resolveFrameworkFromPath('documentation/regexbuilder/regex', 'Swift'),
		'RegexBuilder',
	);
	// A real (if unindexed) framework in the path wins over the caller's fallback.
	assert.strictEqual(
		resolveFrameworkFromPath('objectivec/nsobject', 'AppKit'),
		'ObjectiveC',
	);
	// Genuinely unknown slug must still fall back rather than invent a framework.
	assert.strictEqual(
		resolveFrameworkFromPath('someprivateframework/thing', 'AppKit'),
		'AppKit',
	);
});

// ---------------------------------------------------------------------------
// Fix B: symbol kinds must come from the authority, and never be guessed silently.
// ---------------------------------------------------------------------------

test('resolveSymbolKind prefers canonical symbolKind, then roleHeading', () => {
	assert.strictEqual(resolveSymbolKind({ symbolKind: 'protocol' }), 'protocol');
	assert.strictEqual(
		resolveSymbolKind({ symbolKind: 'Instance Method' }),
		'method',
	);
	assert.strictEqual(resolveSymbolKind({ roleHeading: 'Structure' }), 'struct');
	assert.strictEqual(
		resolveSymbolKind({ roleHeading: 'Protocol' }),
		'protocol',
	);
	assert.strictEqual(
		resolveSymbolKind({ roleHeading: 'Instance Method' }),
		'method',
	);
	assert.strictEqual(
		resolveSymbolKind({ roleHeading: 'Type Property' }),
		'property',
	);
	assert.strictEqual(resolveSymbolKind({ roleHeading: 'Initializer' }), 'init');
	assert.strictEqual(
		resolveSymbolKind({ roleHeading: 'Type Alias' }),
		'typealias',
	);
	assert.strictEqual(resolveSymbolKind({ kind: 'article' }), 'article');
	// No authority available: report unknown explicitly instead of pretending.
	assert.strictEqual(resolveSymbolKind({ kind: 'symbol' }), 'unknown');
	assert.strictEqual(resolveSymbolKind({}), 'unknown');
});

test('search_symbols flags unknown-kind rows instead of presenting them as a real kind', async () => {
	const searchEngine = {
		search: async () => [
			{
				id: '/documentation/swiftui/view',
				framework: 'SwiftUI',
				title: 'View',
				kind: 'symbol',
				abstract: 'A type that represents part of your app UI.',
				path: '/documentation/swiftui/view',
				platforms: ['iOS'],
				score: 100,
				source: 'fts',
			},
		],
		hasSemanticAuth: () => false,
		isCircuitOpen: () => false,
	};

	const handler = buildSearchSymbolsHandler({
		client: {},
		state: new ServerState(),
		searchEngine,
	});
	const out = textOf(await handler({ query: 'View', lexicalOnly: true }));

	assert.ok(
		/\*\*Kind:\*\* unknown/i.test(out),
		`unknown kinds must be labelled unknown, got:\n${out}`,
	);
	assert.ok(
		!/\*\*Kind:\*\* symbol/i.test(out),
		'a generic "symbol" kind must never be presented as if it were a classified kind',
	);
});

test('search_symbols states loudly that results are UNFILTERED when a kind filter matches nothing', async () => {
	const searchEngine = {
		search: async () => [
			{
				id: '/documentation/swiftui/view',
				framework: 'SwiftUI',
				title: 'View',
				kind: 'unknown',
				abstract: 'A type that represents part of your app UI.',
				path: '/documentation/swiftui/view',
				platforms: ['iOS'],
				score: 100,
				source: 'fts',
			},
		],
		hasSemanticAuth: () => false,
		isCircuitOpen: () => false,
	};

	const handler = buildSearchSymbolsHandler({
		client: {},
		state: new ServerState(),
		searchEngine,
	});
	const out = textOf(
		await handler({ query: 'View', symbolType: 'protocol', lexicalOnly: true }),
	);

	assert.ok(
		/unfiltered|NOT filtered/i.test(out),
		`filter relaxation must be stated explicitly, got:\n${out}`,
	);
});

test('search_symbols treats a generic "symbol" kind row as unknown for filtering purposes', async () => {
	const searchEngine = {
		search: async () => [
			{
				id: '/documentation/swiftdata/modelcontainer',
				framework: 'SwiftData',
				title: 'ModelContainer',
				kind: 'symbol',
				abstract: 'Manages an app schema and storage.',
				path: '/documentation/swiftdata/modelcontainer',
				platforms: ['iOS'],
				score: 100,
				source: 'fts',
			},
		],
		hasSemanticAuth: () => false,
		isCircuitOpen: () => false,
	};

	const handler = buildSearchSymbolsHandler({
		client: {},
		state: new ServerState(),
		searchEngine,
	});
	const out = textOf(
		await handler({
			query: 'ModelContainer',
			symbolType: 'class',
			lexicalOnly: true,
		}),
	);

	assert.ok(
		/unfiltered|NOT filtered/i.test(out),
		'an unknown-kind row must not silently satisfy a class filter',
	);
});

// ---------------------------------------------------------------------------
// Fix B (ingestion): a classified kind must never be downgraded by a later
// pass that only knows the generic "symbol" kind.
// ---------------------------------------------------------------------------

test('insertSymbol never downgrades a classified kind to an unclassified one', () => {
	const { db } = makeDb();

	db.insertSymbol({
		id: '/documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: '',
		path: '/documentation/swiftui/view',
		platforms: ['iOS'],
		isPrimaryType: true,
	});
	// Page-reference pass: no kind authority, would otherwise clobber "protocol".
	db.insertSymbol({
		id: '/documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'unknown',
		abstract: 'A type that represents part of your app UI.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS'],
		isPrimaryType: false,
	});

	assert.strictEqual(
		db.countUnknownKind(),
		0,
		'an unclassified pass must not overwrite an authoritative kind',
	);

	// The reverse direction must still upgrade: unknown -> classified wins.
	db.insertSymbol({
		id: '/documentation/swiftdata/modelcontainer',
		framework: 'SwiftData',
		title: 'ModelContainer',
		kind: 'unknown',
		abstract: '',
		path: '/documentation/swiftdata/modelcontainer',
		platforms: ['iOS'],
		isPrimaryType: false,
	});
	db.insertSymbol({
		id: '/documentation/swiftdata/modelcontainer',
		framework: 'SwiftData',
		title: 'ModelContainer',
		kind: 'class',
		abstract: '',
		path: '/documentation/swiftdata/modelcontainer',
		platforms: ['iOS'],
		isPrimaryType: true,
	});

	assert.strictEqual(
		db.countUnknownKind(),
		0,
		'a classified pass must upgrade an unclassified row',
	);
});
