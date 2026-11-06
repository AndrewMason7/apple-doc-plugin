import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import { HybridSearchEngine } from '../../dist/server/services/search/hybrid-search.js';

test('HybridSearchEngine expands "useEffect" query to retrieve task and onAppear symbols', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/view/task',
		framework: 'SwiftUI',
		title: 'task',
		kind: 'method',
		abstract: 'Adds an asynchronous task to perform before this view appears.',
		path: '/documentation/swiftui/view/task',
		platforms: ['iOS 15.0+'],
		isPrimaryType: false,
	});
	db.insertSymbol({
		id: 'documentation/swiftui/view/onappear',
		framework: 'SwiftUI',
		title: 'onAppear',
		kind: 'method',
		abstract: 'Adds an action to perform before this view appears.',
		path: '/documentation/swiftui/view/onappear',
		platforms: ['iOS 13.0+'],
		isPrimaryType: false,
	});
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

	const engine = new HybridSearchEngine(db, { apiKey: null });
	const results = await engine.search('useEffect');

	assert.ok(
		results.length > 0,
		'Expected results for cross-framework "useEffect" query',
	);
	const titles = results.map((r) => r.title.toLowerCase());
	assert.ok(
		titles.includes('task') || titles.includes('onappear'),
		`Expected task or onAppear in results, got: ${titles.join(', ')}`,
	);

	// When expandQuery is explicitly disabled, no expansion should happen
	const unexpandedResults = await engine.search('useEffect', {
		expandQuery: false,
	});
	assert.strictEqual(unexpandedResults.length, 0);

	db.close();
});

test('HybridSearchEngine expands "shared preferences" to retrieve AppStorage and UserDefaults', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/appstorage',
		framework: 'SwiftUI',
		title: 'AppStorage',
		kind: 'propertyWrapper',
		abstract:
			'A property wrapper type that reflects a value from UserDefaults and invalidates a view on a change in value.',
		path: '/documentation/swiftui/appstorage',
		platforms: ['iOS 14.0+'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/foundation/userdefaults',
		framework: 'Foundation',
		title: 'UserDefaults',
		kind: 'class',
		abstract: 'An interface to the user’s defaults database.',
		path: '/documentation/foundation/userdefaults',
		platforms: ['iOS 2.0+'],
		isPrimaryType: true,
	});

	const engine = new HybridSearchEngine(db, { apiKey: null });
	const results = await engine.search('shared preferences');

	assert.ok(results.length > 0);
	const titles = results.map((r) => r.title);
	assert.ok(titles.includes('AppStorage') || titles.includes('UserDefaults'));

	db.close();
});

test('HybridSearchEngine expands "Flexbox" to retrieve HStack and VStack', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/hstack',
		framework: 'SwiftUI',
		title: 'HStack',
		kind: 'struct',
		abstract: 'A view that arranges its subviews in a horizontal line.',
		path: '/documentation/swiftui/hstack',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/swiftui/vstack',
		framework: 'SwiftUI',
		title: 'VStack',
		kind: 'struct',
		abstract: 'A view that arranges its subviews in a vertical line.',
		path: '/documentation/swiftui/vstack',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});

	const engine = new HybridSearchEngine(db, { apiKey: null });
	const results = await engine.search('display: flex');

	assert.ok(results.length > 0);
	const titles = results.map((r) => r.title);
	assert.ok(titles.includes('HStack') || titles.includes('VStack'));

	db.close();
});
