import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { ServerState } from '../dist/server/state.js';

test('Observation framework integrity: no foreign symbols in Observation', async () => {
	const db = new AppleDocsDB('data/apple-docs.db');

	// Query foreign symbols currently tagged as 'Observation'
	const row = db.db
		.prepare(
			`SELECT count(*) as count FROM symbols WHERE framework = 'Observation' AND path NOT LIKE '/documentation/observation%'`,
		)
		.get();

	assert.strictEqual(
		row.count,
		0,
		`Expected 0 foreign symbols in Observation, but found ${row.count}`,
	);

	// Searching 'Observable' scoped to Observation must return Observation symbols, not stdlib Bool or Int
	const state = new ServerState();
	const searchEngine = new HybridSearchEngine(db);
	const res = await buildSearchSymbolsHandler({
		client: {},
		state,
		db,
		searchEngine,
	})({
		query: 'Observable',
		framework: 'Observation',
	});

	const text = res.content[0].text;
	assert.ok(
		text.includes('/documentation/observation/'),
		'Should return symbols under /documentation/observation/',
	);
	assert.ok(
		!text.includes('Bool.toggle'),
		'Observation search should not return Swift stdlib Bool.toggle',
	);

	db.close();
});
