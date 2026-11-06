import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	AppleDocsDB,
	MIN_SEMANTIC_ITEMS_FOR_HYBRID,
} from '../../dist/server/db/database.js';
import {
	buildSymbolEmbeddingText,
	embedSymbols,
	selectEmbeddingCandidates,
} from '../../dist/server/services/symbol-embeddings.js';

const makeDb = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-embed-'));
	return new AppleDocsDB(path.join(dir, 'test.db'));
};

const addSymbol = (db, over = {}) =>
	db.insertSymbol({
		id: over.id ?? '/documentation/swiftui/griditem',
		framework: over.framework ?? 'SwiftUI',
		title: over.title ?? 'GridItem',
		kind: over.kind ?? 'struct',
		abstract: over.abstract ?? '',
		path: over.path ?? '/documentation/swiftui/griditem',
		platforms: over.platforms ?? ['iOS'],
		isPrimaryType: over.isPrimaryType ?? true,
	});

/** Deterministic stand-in for the GGUF provider: hash text into a 768-d vector. */
const stubProvider = (dims = 768) => ({
	id: 'local-gguf',
	dimensions: dims,
	calls: 0,
	isAvailable: () => true,
	embedQuery: async () => null,
	embedDocument: async function (content, title) {
		this.calls++;
		const seed = `${title ?? ''}|${content}`;
		const vec = new Float32Array(dims);
		for (let i = 0; i < dims; i++) {
			vec[i] = ((seed.charCodeAt(i % seed.length) + i) % 97) / 97;
		}
		return vec;
	},
});

test('buildSymbolEmbeddingText uses the abstract verbatim', () => {
	const abstract = 'A description of a row or a column in a lazy grid.';
	const text = buildSymbolEmbeddingText({
		title: 'GridItem',
		kind: 'struct',
		framework: 'SwiftUI',
		abstract,
	});

	// The provider already prefixes `title: GridItem | text: ...`; adding a
	// classification headline on top measurably lowered cosine scores, so the
	// document text must be exactly Apple's abstract.
	assert.strictEqual(text, abstract);
	assert.ok(
		!/struct in SwiftUI/.test(text),
		'the classification headline must not be prepended to a real abstract',
	);
});

test('buildSymbolEmbeddingText stays useful when the abstract is missing', () => {
	const text = buildSymbolEmbeddingText({
		title: 'GridItem',
		kind: 'struct',
		framework: 'SwiftUI',
		abstract: '',
	});

	assert.ok(text.includes('GridItem'));
	assert.ok(/struct/.test(text));
	assert.ok(/SwiftUI/.test(text));
	assert.ok(
		!/undefined|null|\|\s*$/.test(text),
		`no empty placeholder should leak into the document text, got: ${text}`,
	);
});

test('selectEmbeddingCandidates defaults to primary types and documented symbols', () => {
	const db = makeDb();
	addSymbol(db, { id: '/documentation/swiftui/griditem', title: 'GridItem' });
	addSymbol(db, {
		id: '/documentation/swiftui/view/ondrop(of:delegate:)',
		title: 'onDrop(of:delegate:)',
		kind: 'method',
		abstract: '',
		isPrimaryType: false,
	});
	addSymbol(db, {
		id: '/documentation/swiftui/view/task(priority:_:)',
		title: 'task(priority:_:)',
		kind: 'method',
		abstract: 'Adds an asynchronous task to run before the view appears.',
		isPrimaryType: false,
	});

	const candidates = selectEmbeddingCandidates(db);
	const titles = candidates.map((c) => c.title);

	assert.ok(titles.includes('GridItem'), 'primary types must be embedded');
	assert.ok(
		titles.includes('task(priority:_:)'),
		'symbols with a documented abstract must be embedded',
	);
	assert.ok(
		!titles.includes('onDrop(of:delegate:)'),
		'undocumented methods are excluded from the default selection',
	);
});

test('embedSymbols writes semantic items and is resumable', async () => {
	const db = makeDb();
	for (let i = 0; i < 4; i++) {
		addSymbol(db, {
			id: `/documentation/swiftui/type${i}`,
			title: `Type${i}`,
			path: `/documentation/swiftui/type${i}`,
			abstract: `Type ${i} does something useful.`,
		});
	}

	const provider = stubProvider();
	const first = await embedSymbols(db, provider, { batchSize: 2 });

	assert.strictEqual(first.embedded, 4);
	assert.strictEqual(db.getSemanticItemCount(), 4);

	// Second run must not re-embed anything (resumable by semantic item id).
	const second = await embedSymbols(db, provider, { batchSize: 2 });
	assert.strictEqual(second.embedded, 0);
	assert.strictEqual(second.skipped, 4);
	assert.strictEqual(db.getSemanticItemCount(), 4);
});

test('embedSymbols respects a limit and reports progress counters', async () => {
	const db = makeDb();
	for (let i = 0; i < 5; i++) {
		addSymbol(db, {
			id: `/documentation/swiftui/type${i}`,
			title: `Type${i}`,
			path: `/documentation/swiftui/type${i}`,
		});
	}

	const provider = stubProvider();
	const result = await embedSymbols(db, provider, { limit: 2 });

	assert.strictEqual(result.embedded, 2);
	assert.strictEqual(db.getSemanticItemCount(), 2);
});

test('embedding the symbol layer flips the index into hybrid mode', async () => {
	const db = makeDb();
	for (let i = 0; i < MIN_SEMANTIC_ITEMS_FOR_HYBRID; i++) {
		addSymbol(db, {
			id: `/documentation/swiftui/type${i}`,
			title: `Type${i}`,
			path: `/documentation/swiftui/type${i}`,
			abstract: `Symbol ${i}`,
		});
	}

	assert.strictEqual(db.getEmbeddingStatus().hybridEnabled, false);

	await embedSymbols(db, stubProvider(), {});

	const status = db.getEmbeddingStatus();
	assert.strictEqual(status.hybridEnabled, true);
	assert.strictEqual(status.mode, 'hybrid');
	assert.ok(status.semanticItemCount >= MIN_SEMANTIC_ITEMS_FOR_HYBRID);
});

test('embedSymbols refuses to run without an available provider', async () => {
	const db = makeDb();
	addSymbol(db);

	const unavailable = {
		id: 'unavailable',
		dimensions: 0,
		isAvailable: () => false,
		embedQuery: async () => null,
		embedDocument: async () => null,
	};

	await assert.rejects(() => embedSymbols(db, unavailable, {}), /provider/i);
});

test('updateSymbolAbstract backfills an abstract, making the symbol embeddable', () => {
	const db = makeDb();
	// A documented-but-untyped method is only a candidate once it has an abstract.
	addSymbol(db, {
		id: '/documentation/swiftui/view/ondrop(of:delegate:)',
		title: 'onDrop(of:delegate:)',
		kind: 'method',
		abstract: '',
		isPrimaryType: false,
	});

	assert.strictEqual(selectEmbeddingCandidates(db).length, 0);

	db.updateSymbolAbstract(
		'/documentation/swiftui/view/ondrop(of:delegate:)',
		'Defines the destination for a drag-and-drop operation.',
	);

	const candidates = selectEmbeddingCandidates(db);
	assert.strictEqual(candidates.length, 1);
	assert.match(candidates[0].abstract, /drag-and-drop/);
	assert.strictEqual(db.countUnknownKind(), 0, 'kind must remain classified');
});

test('getMemberSymbolsForEnrichment targets undocumented members of reachable frameworks only', () => {
	const db = makeDb();
	// Documented primary type: already covered by the default embedding pass.
	addSymbol(db, {
		id: '/documentation/swiftui/griditem',
		title: 'GridItem',
		abstract: 'A grid row.',
	});
	// Undocumented SwiftUI member: the thing conceptual queries miss.
	addSymbol(db, {
		id: '/documentation/swiftui/view/task',
		title: 'task',
		kind: 'method',
		abstract: '',
		isPrimaryType: false,
		path: '/documentation/swiftui/view/task',
	});
	// Already documented member: nothing to fetch.
	addSymbol(db, {
		id: '/documentation/swiftui/view/onappear',
		title: 'onAppear',
		kind: 'method',
		abstract: 'Adds an action to perform before this view appears.',
		isPrimaryType: false,
		path: '/documentation/swiftui/view/onappear',
	});
	// Undocumented member outside the default scope.
	addSymbol(db, {
		id: '/documentation/foundation/urlsession/datatask',
		title: 'dataTask',
		kind: 'method',
		abstract: '',
		isPrimaryType: false,
		path: '/documentation/foundation/urlsession/datatask',
		framework: 'Foundation',
	});

	const members = db.getMemberSymbolsForEnrichment();
	const titles = members.map((m) => m.title);

	assert.deepStrictEqual(titles, ['task']);
	assert.strictEqual(members[0].framework, 'SwiftUI');
	assert.strictEqual(members[0].kind, 'method');
});

test('force re-embeds rows that already have a vector', async () => {
	const db = makeDb();
	for (let i = 0; i < 3; i++) {
		addSymbol(db, {
			id: `/documentation/swiftui/type${i}`,
			title: `Type${i}`,
			path: `/documentation/swiftui/type${i}`,
			abstract: `Type ${i} does something useful.`,
		});
	}

	const provider = stubProvider();
	await embedSymbols(db, provider, {});
	const before = provider.calls;

	// Resume semantics: nothing to do.
	const skipped = await embedSymbols(db, provider, {});
	assert.strictEqual(skipped.embedded, 0);
	assert.strictEqual(provider.calls, before);

	// After a document-text change the vectors are stale, so they must be redone.
	const forced = await embedSymbols(db, provider, { force: true });
	assert.strictEqual(forced.embedded, 3);
	assert.strictEqual(forced.skipped, 0);
	assert.strictEqual(provider.calls, before + 3);
});
