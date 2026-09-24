import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { buildGetDocumentationHandler } from '../dist/server/handlers/get-documentation.js';
import { ServerState } from '../dist/server/state.js';

test('AppleDocsDB.resolveSymbol resolves by title, case-insensitive path, and returns disambiguation', () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/navigationstack',
		framework: 'SwiftUI',
		title: 'NavigationStack',
		kind: 'struct',
		abstract: 'A view that displays a root view and enables you to present additional views over the root view.',
		path: '/documentation/swiftui/navigationstack',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});

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
		id: 'documentation/appkit/nsview',
		framework: 'AppKit',
		title: 'View',
		kind: 'class',
		abstract: 'An AppKit view.',
		path: '/documentation/appkit/nsview',
		platforms: ['macOS'],
		isPrimaryType: true,
	});

	// 1. Resolve by exact title "NavigationStack" (which previously had path == title count of 0)
	const resNav = db.resolveSymbol('NavigationStack');
	assert.ok(resNav.symbol, 'Should resolve NavigationStack by title');
	assert.strictEqual(resNav.symbol?.path, '/documentation/swiftui/navigationstack');

	// 2. Resolve case-insensitive path "SwiftUI/NavigationStack"
	const resCase = db.resolveSymbol('SwiftUI/NavigationStack');
	assert.ok(resCase.symbol, 'Should resolve case-insensitive SwiftUI/NavigationStack');
	assert.strictEqual(resCase.symbol?.path, '/documentation/swiftui/navigationstack');

	// 3. Resolve "View" with explicit framework "SwiftUI"
	const resViewSwiftUI = db.resolveSymbol('View', 'SwiftUI');
	assert.ok(resViewSwiftUI.symbol, 'Should resolve View in SwiftUI');
	assert.strictEqual(resViewSwiftUI.symbol?.framework, 'SwiftUI');

	// 4. Resolve "View" without framework -> multiple matches -> returns candidates for disambiguation
	const resViewAmbiguous = db.resolveSymbol('View');
	assert.ok(resViewAmbiguous.candidates, 'Should return candidates for ambiguous View');
	assert.ok(resViewAmbiguous.candidates.length >= 2);

	db.close();
});

test('get_documentation resolves title "NavigationStack" directly without requiring choose_technology', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/navigationstack',
		framework: 'SwiftUI',
		title: 'NavigationStack',
		kind: 'struct',
		abstract: 'A view that displays a root view.',
		path: '/documentation/swiftui/navigationstack',
		platforms: ['iOS'],
		isPrimaryType: true,
	});

	const handler = buildGetDocumentationHandler({
		client: {
			extractText: (abs) => (Array.isArray(abs) ? abs.map((a) => a.text).join('') : ''),
		},
		state: new ServerState(),
		db,
	});

	// Agent calls path: "NavigationStack" without framework or "documentation/" prefix
	const res = await handler({ path: 'NavigationStack' });
	assert.strictEqual(res.isError, undefined);
	assert.ok(res.content[0].text.includes('NavigationStack'));
	assert.ok(res.content[0].text.includes('SwiftUI'));

	db.close();
});

test('get_documentation returns isError: true and UNRESOLVED for completely non-existent symbols', async () => {
	const db = new AppleDocsDB(':memory:');
	const handler = buildGetDocumentationHandler({
		client: {
			getSymbol: async () => {
				throw new Error('Not found on CDN');
			},
			extractText: () => '',
		},
		state: new ServerState(),
		db,
	});

	const res = await handler({ path: 'NonExistentSymbol12345' });
	assert.strictEqual(res.isError, true);
	assert.ok(res.content[0].text.startsWith('UNRESOLVED:'));

	db.close();
});

test('get_documentation returns disambiguation list with copy-paste calls when multiple symbols match', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/button',
		framework: 'SwiftUI',
		title: 'Button',
		kind: 'struct',
		abstract: 'A SwiftUI button.',
		path: '/documentation/swiftui/button',
		platforms: ['iOS'],
	});
	db.insertSymbol({
		id: 'documentation/appkit/nsbutton',
		framework: 'AppKit',
		title: 'Button',
		kind: 'class',
		abstract: 'An AppKit button.',
		path: '/documentation/appkit/nsbutton',
		platforms: ['macOS'],
	});

	const handler = buildGetDocumentationHandler({
		client: {
			extractText: () => '',
		},
		state: new ServerState(),
		db,
	});

	const res = await handler({ path: 'Button' });
	assert.strictEqual(res.isError, true);
	assert.ok(res.content[0].text.includes('Multiple symbols match "Button"'));
	assert.ok(res.content[0].text.includes('get_documentation({ "path": "/documentation/swiftui/button", "framework": "SwiftUI" })'));
	assert.ok(res.content[0].text.includes('get_documentation({ "path": "/documentation/appkit/nsbutton", "framework": "AppKit" })'));

	db.close();
});
