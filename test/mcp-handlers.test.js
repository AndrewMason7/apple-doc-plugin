import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';
import { AppleDevDocsClient } from '../dist/apple-client.js';

const offlineClient = {
	extractText: () => {
		throw new Error('extractText should not run when the network client fails');
	},
	formatPlatforms: () => {
		throw new Error(
			'formatPlatforms should not run when the network client fails',
		);
	},
	getFramework: async () => {
		throw new Error('network down');
	},
	getSymbol: async () => {
		throw new Error('network down');
	},
	getTechnologies: async () => {
		throw new Error('network down');
	},
};

test('search_symbols succeeds globally when no technology is selected', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A type that represents part of the user interface.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});

	const state = new ServerState();
	const searchEngine = new HybridSearchEngine(db, { apiKey: null });
	const client = new AppleDevDocsClient();

	const handler = buildSearchSymbolsHandler({
		client,
		state,
		db,
		searchEngine,
	});

	const response = await handler({ query: 'View' });
	const text = response.content[0].text;
	assert.strictEqual(response.isError, undefined);
	assert.ok(text.includes('### View (SwiftUI)'));
	assert.ok(text.includes('**Kind:** protocol'));
	assert.ok(text.includes('iOS 13.0+'));
	assert.ok(!text.includes('No technology selected'));
	assert.ok(!text.includes('CANNOT work without first selecting'));
	db.close();
});

test('search_symbols respects framework argument', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/color',
		framework: 'SwiftUI',
		title: 'Color',
		kind: 'struct',
		abstract: 'A representation of a color in SwiftUI.',
		path: '/documentation/swiftui/color',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/uikit/uicolor',
		framework: 'UIKit',
		title: 'UIColor',
		kind: 'class',
		abstract: 'An object that stores color data.',
		path: '/documentation/uikit/uicolor',
		platforms: ['iOS 2.0+'],
		isPrimaryType: true,
	});

	const state = new ServerState();
	const searchEngine = new HybridSearchEngine(db, { apiKey: null });
	const client = new AppleDevDocsClient();

	const handler = buildSearchSymbolsHandler({
		client,
		state,
		db,
		searchEngine,
	});

	const response = await handler({ query: 'Color', framework: 'swiftui' });
	const text = response.content[0].text;
	assert.ok(text.includes('### Color (SwiftUI)'));
	assert.ok(!text.includes('UIColor'));
	assert.ok(!text.includes('UIKit'));
	db.close();
});

test('get_documentation validates empty path and returns isError: true', async () => {
	const { buildGetDocumentationHandler } =
		await import('../dist/server/handlers/get-documentation.js');
	const handler = buildGetDocumentationHandler({
		client: offlineClient,
		state: new ServerState(),
	});

	const res = await handler({ path: '   ' });
	assert.strictEqual(res.isError, true);
	assert.strictEqual(
		res.content[0].text,
		'Error: A non-empty "path" parameter is required.',
	);
});

test('get_documentation resolves using local db when no technology is selected', async () => {
	const { buildGetDocumentationHandler } =
		await import('../dist/server/handlers/get-documentation.js');
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/button',
		framework: 'SwiftUI',
		title: 'Button',
		kind: 'struct',
		abstract: 'A control that initiates an action.',
		path: '/documentation/swiftui/button',
		platforms: ['iOS 13.0+', 'macOS 10.15+'],
		isPrimaryType: true,
	});

	const state = new ServerState();
	const handler = buildGetDocumentationHandler({
		client: offlineClient,
		state,
		db,
	});

	const res = await handler({ path: '/documentation/swiftui/button' });
	assert.notStrictEqual(res.isError, true);
	assert.strictEqual(
		res.content[0].text,
		[
			'# Button',
			'',
			'**Technology:** SwiftUI',
			'**Type:** struct',
			'**Platforms:** iOS 13.0+, macOS 10.15+',
			'',
			'## Overview',
			'A control that initiates an action.',
		].join('\n'),
	);
	assert.strictEqual(state.getActiveTechnology(), undefined);

	db.close();
});

test('get_documentation returns isError: true gracefully for non-existent path', async () => {
	const { buildGetDocumentationHandler } =
		await import('../dist/server/handlers/get-documentation.js');
	const db = new AppleDocsDB(':memory:');
	const handler = buildGetDocumentationHandler({
		client: offlineClient,
		state: new ServerState(),
		db,
	});

	const res = await handler({
		path: 'documentation/nonexistentframework/nonexistent',
	});
	assert.strictEqual(res.isError, true);
	assert.match(
		res.content[0].text,
		/Failed to load documentation for "documentation\/nonexistentframework\/nonexistent": network down/,
	);
	assert.ok(
		!res.content[0].text.includes('CANNOT work without first selecting'),
	);

	db.close();
});

test('get_documentation does not leak or mutate session state active technology', async () => {
	const { buildGetDocumentationHandler } =
		await import('../dist/server/handlers/get-documentation.js');
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/text',
		framework: 'SwiftUI',
		title: 'Text',
		kind: 'struct',
		abstract: 'A view that displays one or more lines of read-only text.',
		path: '/documentation/swiftui/text',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});

	const state = new ServerState();
	assert.strictEqual(
		state.getActiveTechnology(),
		undefined,
		'Initially no technology should be active',
	);

	const handler = buildGetDocumentationHandler({
		client: offlineClient,
		state,
		db,
	});

	const res = await handler({ path: '/documentation/swiftui/text' });
	assert.notStrictEqual(res.isError, true);
	assert.ok(
		res.content[0].text.includes(
			'A view that displays one or more lines of read-only text.',
		),
	);
	assert.strictEqual(
		state.getActiveTechnology(),
		undefined,
		'State active technology must remain undefined',
	);

	db.close();
});

test('queryFTS guarantees exact title match is ranked #1 even among many token prefix hits', () => {
	const db = new AppleDocsDB(':memory:');
	// Insert many methods with "View" prefix that would dominate BM25
	for (let i = 0; i < 20; i++) {
		db.insertSymbol({
			id: `doc/init-viewing-${i}`,
			framework: 'SwiftUI',
			title: `init(viewing:viewer:${i})`,
			kind: 'initializer',
			abstract:
				'Viewing viewer initializer method with repeated view tokens view view view',
			path: `/doc/init-viewing-${i}`,
			platforms: ['iOS'],
		});
	}

	// Insert exact symbol "View" with broad abstract
	db.insertSymbol({
		id: '/documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract:
			'A type that represents part of your app’s user interface and provides modifiers that you use to configure views.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});

	db.insertSymbol({
		id: '/documentation/uikit/view',
		framework: 'UIKit',
		title: 'View',
		kind: 'class',
		abstract: 'A UIKit view.',
		path: '/documentation/uikit/view',
		platforms: ['iOS'],
		isPrimaryType: false,
	});

	const results = db.queryFTS('view', undefined, 5);
	assert.strictEqual(results.length, 5);
	assert.strictEqual(
		results[0].title,
		'View',
		'Exact symbol View must be ranked #1',
	);
	assert.strictEqual(
		results[0].framework,
		'SwiftUI',
		'Primary exact match ranks ahead of a non-primary exact match',
	);
	assert.strictEqual(results[0].score, 1000.0);
	assert.strictEqual(results[1].framework, 'UIKit');
	assert.strictEqual(results[1].score, 1000.0);
	assert.ok(results.slice(2).every((row) => row.score < 1000));

	db.close();
});
