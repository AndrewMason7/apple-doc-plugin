import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { ServerState } from '../dist/server/state.js';

test('Wildcards: FTS and LIKE wildcard handling for *, *suffix, and ?', () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/griditem',
		framework: 'SwiftUI',
		title: 'GridItem',
		kind: 'struct',
		abstract: 'A description of an item organized within a grid layout.',
		path: '/documentation/swiftui/griditem',
		platforms: ['iOS 14.0+'],
	});

	// 1. Prefix wildcard (e.g. Grid*)
	const resPrefix = db.queryFTS('Grid*');
	assert.strictEqual(resPrefix.length, 1);
	assert.strictEqual(resPrefix[0].title, 'GridItem');

	// 2. Suffix wildcard (e.g. *Item)
	const resSuffix = db.queryFTS('*Item');
	assert.strictEqual(resSuffix.length, 1);
	assert.strictEqual(resSuffix[0].title, 'GridItem');

	// 3. Single-character wildcard matches one character, not a longer title.
	db.insertSymbol({
		id: 'documentation/swiftui/gridxitem',
		framework: 'SwiftUI',
		title: 'GridXtem',
		kind: 'struct',
		abstract: 'Another grid type.',
		path: '/documentation/swiftui/gridxitem',
		platforms: ['iOS'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/swiftui/griditemextra',
		framework: 'SwiftUI',
		title: 'GridItemExtra',
		kind: 'struct',
		abstract: 'Not a single-character match.',
		path: '/documentation/swiftui/griditemextra',
		platforms: ['iOS'],
		isPrimaryType: true,
	});
	const resSingle = db.queryFTS('Grid?tem');
	const singleTitles = resSingle.map((row) => row.title).sort();
	assert.deepStrictEqual(singleTitles, ['GridItem', 'GridXtem']);

	// Suffix match is the end of the title, so Itemizer stays out.
	db.insertSymbol({
		id: 'documentation/swiftui/itemizer',
		framework: 'SwiftUI',
		title: 'Itemizer',
		kind: 'struct',
		abstract: 'Does not end in Item.',
		path: '/documentation/swiftui/itemizer',
		platforms: ['iOS'],
	});
	const suffixTitles = db.queryFTS('*Item').map((row) => row.title);
	assert.ok(suffixTitles.includes('GridItem'));
	assert.ok(!suffixTitles.includes('Itemizer'));
	assert.ok(!suffixTitles.includes('GridItemExtra'));

	db.close();
});

test('Wildcards: Suffix wildcard prioritizes primary types and shorter titles under limit', () => {
	const db = new AppleDocsDB(':memory:');

	// Insert a sprawling internal type first (which would be visited first without ORDER BY)
	db.insertSymbol({
		id: 'sym-internal-long',
		framework: 'SwiftUI',
		title: '_InternalSprawlingPrimitiveButtonStyleConfigurationLabelWrapper',
		kind: 'struct',
		abstract: 'Internal wrapper',
		path: '/doc/internal',
		platforms: ['iOS'],
		isPrimaryType: false,
	});

	// Insert concise primary types later in the table
	db.insertSymbol({
		id: 'sym-button-style',
		framework: 'SwiftUI',
		title: 'ButtonStyle',
		kind: 'protocol',
		abstract:
			'A type that applies standard interaction behavior and a custom appearance to all buttons.',
		path: '/documentation/swiftui/buttonstyle',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});

	db.insertSymbol({
		id: 'sym-list-style',
		framework: 'SwiftUI',
		title: 'ListStyle',
		kind: 'protocol',
		abstract: 'A specification for the appearance and interaction of a list.',
		path: '/documentation/swiftui/liststyle',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});

	// Query with limit 2 - should return ListStyle and ButtonStyle, excluding the long internal type
	const res = db.queryFTS('*Style', undefined, 2);
	assert.deepStrictEqual(
		res.map((row) => row.title),
		['ListStyle', 'ButtonStyle'],
		'Shorter primary titles rank ahead of longer ones',
	);
	assert.ok(res.every((row) => row.isPrimaryType));
	assert.ok(res[0].score >= res[1].score);

	db.close();
});

test('Handler: clamps maxResults (including NaN and negatives) and validates query', async () => {
	const db = new AppleDocsDB(':memory:');
	for (let i = 0; i < 15; i++) {
		db.insertSymbol({
			id: `sym-${i}`,
			framework: 'SwiftUI',
			title: `View${i}`,
			kind: 'struct',
			abstract: `View component ${i}`,
			path: `/documentation/swiftui/view${i}`,
			platforms: [],
		});
	}

	const searchEngine = new HybridSearchEngine(db, { apiKey: null });
	const handler = buildSearchSymbolsHandler({
		client: {},
		state: new ServerState(),
		db,
		searchEngine,
	});

	// 1. Empty query returns isError: true
	// @ts-ignore
	const errRes = await handler({ query: '' });
	assert.strictEqual(errRes.isError, true);

	// 2. Whitespace query returns isError: true
	const wsRes = await handler({ query: '   ' });
	assert.strictEqual(wsRes.isError, true);

	// 3. maxResults negative clamps strictly to 1
	const minRes = await handler({ query: 'View', maxResults: -10 });
	assert(!minRes.isError);
	assert(
		minRes.content[0].text.includes('**Matches Found:** 1\n'),
		'Negative maxResults must clamp to exactly 1',
	);

	// 4. maxResults NaN defaults gracefully without SQL error
	const nanRes = await handler({ query: 'View', maxResults: NaN });
	assert.strictEqual(nanRes.isError, undefined);
	assert.ok(nanRes.content[0].text.includes('**Matches Found:** 15\n'));

	// 5. Non-finite values use the default of 20, and values above 100 clamp.
	const infRes = await handler({
		query: 'View',
		maxResults: Number.POSITIVE_INFINITY,
	});
	assert.ok(infRes.content[0].text.includes('**Matches Found:** 15\n'));

	for (let i = 0; i < 120; i++) {
		db.insertSymbol({
			id: `alpha-${i}`,
			framework: 'SwiftUI',
			title: `Alpha${i}`,
			kind: 'struct',
			abstract: 'Alpha symbol',
			path: `/documentation/swiftui/alpha${i}`,
			platforms: ['iOS'],
		});
	}
	const capped = await handler({ query: 'Alpha', maxResults: 1000 });
	assert.ok(
		capped.content[0].text.includes('**Matches Found:** 100\n'),
		'maxResults above 100 must clamp to 100',
	);
	const fractional = await handler({ query: 'Alpha', maxResults: 1.9 });
	assert.ok(fractional.content[0].text.includes('**Matches Found:** 1\n'));

	db.close();
});

test('Wildcards: infix wildcard Navigation*View and prefix wildcard Grid* match via LIKE pattern', () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/navigationsplitview',
		framework: 'SwiftUI',
		title: 'NavigationSplitView',
		kind: 'struct',
		abstract: 'A view that presents views in two or three columns.',
		path: '/documentation/swiftui/navigationsplitview',
		platforms: ['iOS 16.0+'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/swiftui/navigationstack',
		framework: 'SwiftUI',
		title: 'NavigationStack',
		kind: 'struct',
		abstract: 'A view that displays a root view.',
		path: '/documentation/swiftui/navigationstack',
		platforms: ['iOS 16.0+'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/swiftui/gridrow',
		framework: 'SwiftUI',
		title: 'GridRow',
		kind: 'struct',
		abstract: 'A row container in a Grid.',
		path: '/documentation/swiftui/gridrow',
		platforms: ['iOS 16.0+'],
		isPrimaryType: true,
	});

	// 1. Navigation*View should match NavigationSplitView but NOT NavigationStack
	const navResults = db.queryFTS('Navigation*View');
	const navTitles = navResults.map((r) => r.title);
	assert.ok(
		navTitles.includes('NavigationSplitView'),
		'Navigation*View must match NavigationSplitView',
	);
	assert.ok(
		!navTitles.includes('NavigationStack'),
		'Navigation*View must NOT match NavigationStack',
	);

	// 2. Grid* matches GridRow
	const gridResults = db.queryFTS('Grid*');
	const gridTitles = gridResults.map((r) => r.title);
	assert.ok(gridTitles.includes('GridRow'), 'Grid* must match GridRow');

	db.close();
});
