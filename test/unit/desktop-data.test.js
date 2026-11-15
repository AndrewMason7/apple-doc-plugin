import test from 'node:test';
import assert from 'node:assert/strict';
import {
	PLUGIN_ID,
	STUDIO_ROUTE,
	TOP_FRAMEWORK_PILLS,
} from '../../desktop/src/data/constants.js';
import {
	FALLBACK_STATS,
	FALLBACK_SYMBOLS,
	FALLBACK_IDIOMS,
	COMPILER_PRESETS,
	LOCAL_MIGRATIONS,
} from '../../desktop/src/data/fallbacks.js';

test('desktop constants export valid identifiers and routes', () => {
	assert.equal(PLUGIN_ID, 'apple-doc-plugin');
	assert.equal(STUDIO_ROUTE, '/apple-docs');
	assert.ok(Array.isArray(TOP_FRAMEWORK_PILLS));
	assert.ok(TOP_FRAMEWORK_PILLS.length >= 5);
});

test('desktop fallback datasets adhere to Hermes catalog and database count invariants', () => {
	assert.equal(FALLBACK_STATS.symbolCount, 95899);
	assert.equal(FALLBACK_STATS.frameworkCount, 30);
	assert.equal(FALLBACK_STATS.frameworks.length, 30);
	const frameworkSum = FALLBACK_STATS.frameworks.reduce(
		(sum, f) => sum + f.symbolCount,
		0,
	);
	assert.equal(
		frameworkSum,
		95899,
		'Sum of framework symbol counts must match exactly 95,899',
	);

	assert.ok(Array.isArray(FALLBACK_SYMBOLS));
	assert.ok(FALLBACK_SYMBOLS.length >= 8);
	for (const sym of FALLBACK_SYMBOLS) {
		assert.ok(sym.title, 'Symbol must have a title');
		assert.ok(sym.framework, 'Symbol must have a framework');
	}

	assert.ok(Array.isArray(FALLBACK_IDIOMS));
	assert.ok(FALLBACK_IDIOMS.length >= 5);
	assert.ok(Array.isArray(COMPILER_PRESETS));
	assert.ok(COMPILER_PRESETS.length >= 3);
	assert.ok(LOCAL_MIGRATIONS && typeof LOCAL_MIGRATIONS === 'object');
});
