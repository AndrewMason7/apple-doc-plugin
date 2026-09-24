import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { buildDiscoverHandler } from '../dist/server/handlers/discover.js';
import { ServerState } from '../dist/server/state.js';

test('AppleDocsDB.getFrameworkSymbolCounts returns exact counts per framework', () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A type that represents part of the user interface of an app.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/swiftui/button',
		framework: 'SwiftUI',
		title: 'Button',
		kind: 'struct',
		abstract: 'A control that initiates an action.',
		path: '/documentation/swiftui/button',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/appkit/nsbutton',
		framework: 'AppKit',
		title: 'NSButton',
		kind: 'class',
		abstract: 'A 2-state button.',
		path: '/documentation/appkit/nsbutton',
		platforms: ['macOS'],
		isPrimaryType: true,
	});

	const counts = db.getFrameworkSymbolCounts();
	assert.ok(Array.isArray(counts));
	const swiftUiEntry = counts.find((c) => c.framework === 'SwiftUI');
	const appKitEntry = counts.find((c) => c.framework === 'AppKit');

	assert.strictEqual(swiftUiEntry?.count, 2);
	assert.strictEqual(appKitEntry?.count, 1);

	db.close();
});

test('discover_technologies displays exact symbol counts and valid JSON pagination', async () => {
	const db = new AppleDocsDB(':memory:');
	for (let i = 0; i < 3; i++) {
		db.insertSymbol({
			id: `documentation/swiftui/sym${i}`,
			framework: 'SwiftUI',
			title: `Sym${i}`,
			kind: 'struct',
			abstract: `Abstract ${i}`,
			path: `/documentation/swiftui/sym${i}`,
			platforms: ['iOS'],
			isPrimaryType: true,
		});
	}

	const client = {
		getTechnologies: async () => ({}),
		extractText: (abstract) =>
			Array.isArray(abstract) ? abstract.map((a) => a.text).join('') : '',
	};
	const state = new ServerState();
	const handler = buildDiscoverHandler({ client, state, db });

	// Request with pageSize = 2 to test pagination formatting
	const res = await handler({ page: 1, pageSize: 2 });
	const text = res.content[0].text;

	// Check symbol count presence
	assert.ok(
		text.includes('**Symbols Indexed:** 3'),
		'Should display **Symbols Indexed:** 3 for SwiftUI',
	);

	// Check valid tool call syntax in pagination (not `discover_technologies { "query": ... }`)
	assert.ok(
		text.includes('discover_technologies({ "query": "", "page": 2 })'),
		'Pagination must use valid JSON tool call format discover_technologies({ ... })',
	);
	assert.ok(
		!text.includes('discover_technologies {'),
		'Should not use invalid cli syntax discover_technologies {',
	);

	db.close();
});
