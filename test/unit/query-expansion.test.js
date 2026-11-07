import assert from 'node:assert';
import test from 'node:test';
import {
	CROSS_FRAMEWORK_IDIOMS,
	expandQuery,
} from '../../dist/server/services/search/query-expansion.js';

test('expandQuery: returns hasExpansion=false for empty or whitespace query', () => {
	const resEmpty = expandQuery('');
	assert.strictEqual(resEmpty.hasExpansion, false);
	assert.strictEqual(resEmpty.matchedIdioms.length, 0);
	assert.strictEqual(resEmpty.mappedSymbols.length, 0);

	const resSpaces = expandQuery('    ');
	assert.strictEqual(resSpaces.hasExpansion, false);
});

test('expandQuery: returns hasExpansion=false for pure Apple native queries without idioms', () => {
	const res = expandQuery('NavigationStack');
	assert.strictEqual(res.hasExpansion, false);
	assert.strictEqual(res.matchedIdioms.length, 0);
	assert.strictEqual(res.mappedSymbols.length, 0);
	assert.strictEqual(res.semanticSearchQuery, 'NavigationStack');
});

test('expandQuery: maps React useEffect hook to task, onAppear, onChange', () => {
	const queries = [
		'useEffect',
		'useeffect',
		'USEEFFECT',
		'how to use useEffect()',
	];
	for (const q of queries) {
		const res = expandQuery(q);
		assert.strictEqual(res.hasExpansion, true);
		assert.ok(
			res.mappedSymbols.includes('task'),
			`Expected "task" in mapped symbols for ${q}`,
		);
		assert.ok(
			res.mappedSymbols.includes('onAppear'),
			`Expected "onAppear" in mapped symbols for ${q}`,
		);
		assert.ok(res.semanticSearchQuery.includes('task'));
		assert.ok(res.semanticSearchQuery.includes('SwiftUI'));
	}
});

test('expandQuery: maps Android SharedPreferences to AppStorage and UserDefaults', () => {
	const queries = [
		'SharedPreferences',
		'shared_preferences',
		'shared preferences',
		'how to store data with shared preferences',
	];
	for (const q of queries) {
		const res = expandQuery(q);
		assert.strictEqual(res.hasExpansion, true);
		assert.ok(
			res.mappedSymbols.includes('AppStorage'),
			`Expected AppStorage for ${q}`,
		);
		assert.ok(
			res.mappedSymbols.includes('UserDefaults'),
			`Expected UserDefaults for ${q}`,
		);
		assert.ok(res.expandedFtsQuery.includes('AppStorage'));
	}
});

test('expandQuery: maps Web Flexbox to HStack, VStack, Spacer', () => {
	const queries = ['Flexbox', 'flexbox', 'display: flex', 'css flex'];
	for (const q of queries) {
		const res = expandQuery(q);
		assert.strictEqual(res.hasExpansion, true);
		assert.ok(res.mappedSymbols.includes('HStack'));
		assert.ok(res.mappedSymbols.includes('VStack'));
		assert.ok(res.mappedSymbols.includes('Spacer'));
	}
});

test('expandQuery: maps Android Coroutines to async, await, Task', () => {
	const queries = ['coroutine', 'coroutines', 'kotlin coroutine'];
	for (const q of queries) {
		const res = expandQuery(q);
		assert.strictEqual(res.hasExpansion, true);
		assert.ok(res.mappedSymbols.includes('async'));
		assert.ok(res.mappedSymbols.includes('await'));
		assert.ok(res.mappedSymbols.includes('Task'));
	}
});

test('expandQuery: maps AsyncStorage to AppStorage and UserDefaults', () => {
	const res = expandQuery('react native async storage');
	assert.strictEqual(res.hasExpansion, true);
	assert.ok(res.mappedSymbols.includes('AppStorage'));
	assert.ok(res.mappedSymbols.includes('UserDefaults'));
});

test('expandQuery: maps useState to State and Binding', () => {
	const res = expandQuery('useState hook');
	assert.strictEqual(res.hasExpansion, true);
	assert.ok(res.mappedSymbols.includes('State'));
	assert.ok(res.mappedSymbols.includes('Binding'));
});

test('expandQuery: maps RecyclerView to List, LazyVStack, ScrollView', () => {
	const res = expandQuery('android RecyclerView');
	assert.strictEqual(res.hasExpansion, true);
	assert.ok(res.mappedSymbols.includes('List'));
	assert.ok(res.mappedSymbols.includes('LazyVStack'));
});

test('expandQuery: sanitizes symbol names by stripping leading @ and trailing parens', () => {
	const res = expandQuery('useState');
	for (const sym of res.mappedSymbols) {
		assert.ok(!sym.startsWith('@'), `Symbol should not start with @: ${sym}`);
		assert.ok(!sym.includes('('), `Symbol should not contain parens: ${sym}`);
	}
});

test('CROSS_FRAMEWORK_IDIOMS has definitions across all required categories', () => {
	assert.ok(CROSS_FRAMEWORK_IDIOMS.length >= 15);
	const categories = new Set(CROSS_FRAMEWORK_IDIOMS.map((d) => d.category));
	assert.ok(categories.has('lifecycle'));
	assert.ok(categories.has('state'));
	assert.ok(categories.has('storage'));
	assert.ok(categories.has('layout'));
	assert.ok(categories.has('concurrency'));
});

test('expandQuery: does not falsely expand generic keywords (service, navigation, preferences)', () => {
	const genericQueries = [
		'CoreLocation service',
		'swiftui navigation bar',
		'macOS user preferences window',
		'sqlite connection',
	];

	for (const q of genericQueries) {
		const res = expandQuery(q);
		assert.strictEqual(
			res.hasExpansion,
			false,
			`Query "${q}" should NOT match generic cross-framework idioms`,
		);
	}
});

test('expandQuery: Android onResume correctly maps to onAppear and scenePhase (not onDisappear)', () => {
	const res = expandQuery('android onResume');
	assert.strictEqual(res.hasExpansion, true);
	assert.ok(res.mappedSymbols.includes('onAppear'));
	assert.ok(res.mappedSymbols.includes('scenePhase'));
	assert.ok(!res.mappedSymbols.includes('onDisappear'));
});

test('expandQuery: Android onDestroy maps to onDisappear and deinit', () => {
	const res = expandQuery('onDestroy');
	assert.strictEqual(res.hasExpansion, true);
	assert.ok(res.mappedSymbols.includes('onDisappear'));
	assert.ok(res.mappedSymbols.includes('deinit'));
});

test('expandQuery: matches "Room" case-sensitively so the English word "room" stays out', () => {
	// Regression: "chat room layout" used to match the Room idiom and inject
	// SwiftData/CoreData symbols the caller never asked for.
	const lower = expandQuery('chat room layout');
	assert.strictEqual(lower.hasExpansion, false);
	assert.strictEqual(lower.matchedIdioms.length, 0);

	const upper = expandQuery('Room database');
	assert.strictEqual(upper.hasExpansion, true);
	assert.ok(upper.mappedSymbols.includes('SwiftData'));
	assert.ok(upper.mappedSymbols.includes('ModelContainer'));
});

test('expandQuery: matches "Retrofit" case-sensitively', () => {
	assert.strictEqual(
		expandQuery('retrofit an existing app').hasExpansion,
		false,
	);
	const res = expandQuery('Retrofit client');
	assert.strictEqual(res.hasExpansion, true);
	assert.ok(res.mappedSymbols.includes('URLSession'));
});

test('expandQuery: maps the "view model" phrase to Observable', () => {
	const res = expandQuery('view model architecture');
	assert.strictEqual(res.hasExpansion, true);
	assert.ok(res.mappedSymbols.includes('Observable'));
});
