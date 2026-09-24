import assert from 'node:assert';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const headings = (text) =>
	[...text.matchAll(/^### (.+)$/gm)].map((match) => match[1]);

test('End-to-End: shipped index ranks exact names, suffix wildcards, and platforms', async () => {
	const dbPath = join(__dirname, '../data/apple-docs.db');
	const db = new AppleDocsDB(dbPath, { readonly: true });
	const searchEngine = new HybridSearchEngine(db, { apiKey: null });
	const state = new ServerState();

	const searchHandler = buildSearchSymbolsHandler({
		client: {},
		state,
		db,
		searchEngine,
	});

	const t0 = performance.now();
	const resGlobal = await searchHandler({ query: 'NavigationSplitView' });
	const t1 = performance.now();
	const textGlobal = resGlobal.content[0].text;

	console.log(`Global search took ${(t1 - t0).toFixed(2)}ms`);
	assert.ok(textGlobal.includes('### NavigationSplitView (SwiftUI)'));
	assert.strictEqual(state.getActiveTechnology(), undefined);

	const resUIKit = await searchHandler({
		query: 'ViewController',
		framework: 'UIKit',
	});
	const uikitHeadings = headings(resUIKit.content[0].text);
	assert.ok(
		uikitHeadings.some((heading) => heading.includes('UIViewController')),
	);
	assert.ok(uikitHeadings.every((heading) => heading.endsWith('(UIKit)')));

	const view = db.queryFTS('View', 'SwiftUI', 5);
	assert.strictEqual(view[0].title, 'View');
	assert.strictEqual(view[0].framework, 'SwiftUI');
	assert.strictEqual(view[0].score, 1000);
	assert.ok(view[0].platforms.includes('iOS'));
	assert.ok(view[0].platforms.includes('macOS'));

	const styles = db.queryFTS('*Style', undefined, 10);
	assert.strictEqual(styles.length, 10);
	assert.ok(styles.some((row) => row.title === 'ButtonStyle'));
	assert.ok(styles.some((row) => row.title === 'ListStyle'));
	assert.ok(styles.every((row) => /style$/i.test(row.title)));
	assert.ok(styles.every((row) => row.isPrimaryType));
	for (let i = 1; i < styles.length; i++) {
		assert.ok(styles[i - 1].score >= styles[i].score);
	}

	const ios = await searchHandler({
		query: 'NSWindow',
		platform: 'iOS',
		maxResults: 5,
	});
	const iosText = ios.content[0].text;
	const iosHeadings = headings(iosText);
	assert.ok(!iosHeadings.includes('NSWindow (AppKit)'));
	assert.ok(!iosText.includes('(AppKit)'));
	const iosPlatforms = [...iosText.matchAll(/\*\*Platforms:\*\* (.+)/g)].map(
		(match) => match[1],
	);
	assert.ok(
		iosPlatforms.every((platform) => platform.toLowerCase().includes('ios')),
		`iOS filter leaked non-iOS rows: ${iosPlatforms.join(' | ')}`,
	);

	const macos = await searchHandler({
		query: 'NSWindow',
		platform: 'macOS',
		maxResults: 5,
	});
	const macosHeadings = headings(macos.content[0].text);
	assert.ok(macosHeadings.includes('NSWindow (AppKit)'));
	assert.ok(macosHeadings.every((heading) => heading.endsWith('(AppKit)')));

	const coverage = db['db']
		.prepare(
			`SELECT COUNT(*) AS symbols,
              SUM(CASE WHEN platforms IS NULL OR platforms IN ('', '[]') THEN 1 ELSE 0 END) AS empty_platforms
       FROM symbols`,
		)
		.get();
	assert.ok(coverage.symbols > 60000);
	assert.strictEqual(coverage.empty_platforms, 0);

	db.close();
});

test('End-to-End: get_documentation retrieves local symbols and formats cleanly', async () => {
	const dbPath = join(__dirname, '../data/apple-docs.db');
	const db = new AppleDocsDB(dbPath, { readonly: true });
	const state = new ServerState();
	const { buildGetDocumentationHandler } =
		await import('../dist/server/handlers/get-documentation.js');

	const offlineClient = {
		formatPlatforms: () => 'All platforms',
		extractText: () => '',
		getFramework: async () => {
			throw new Error('offline');
		},
		getSymbol: async () => {
			throw new Error('offline');
		},
		getTechnologies: async () => {
			throw new Error('offline');
		},
	};

	const docHandler = buildGetDocumentationHandler({
		client: offlineClient,
		state,
		db,
	});

	const res = await docHandler({ path: '/documentation/swiftui/view' });
	assert.strictEqual(res.isError, undefined);
	const text = res.content[0].text;
	assert.ok(text.includes('# View'));
	assert.ok(text.includes('**Technology:** SwiftUI'));
	assert.ok(text.includes('**Type:** symbol'));
	assert.ok(text.includes('## Overview'));

	db.close();
});
