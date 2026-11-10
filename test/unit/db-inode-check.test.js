import assert from 'node:assert';
import test from 'node:test';
import { mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import { HybridSearchEngine } from '../../dist/server/services/search/hybrid-search.js';
import { buildVersionHandler, buildIndexInfoHandler } from '../../dist/server/handlers/version.js';
import { buildSearchSymbolsHandler } from '../../dist/server/handlers/search-symbols.js';
import { buildGetDocumentationHandler } from '../../dist/server/handlers/get-documentation.js';
import { buildDiscoverHandler } from '../../dist/server/handlers/discover.js';
import { AppleDevDocsClient } from '../../dist/apple-client.js';
import { ServerState } from '../../dist/server/state.js';

const setupTempDb = () => {
	const dir = mkdtempSync(join(tmpdir(), 'apple-docs-inode-'));
	const dbPath = join(dir, 'test.db');
	const db = new AppleDocsDB(dbPath);
	db.insertSymbol({
		id: '/documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A type that represents part of your app UI.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});
	db.setMeta('built_at', '2026-11-01T00:00:00.000Z');
	return { dir, dbPath, db };
};

test('assertNotReplaced succeeds on valid disk DB and in-memory DB', () => {
	const memDb = new AppleDocsDB(':memory:');
	assert.doesNotThrow(() => memDb.assertNotReplaced());
	memDb.close();

	const { dir, db } = setupTempDb();
	try {
		assert.doesNotThrow(() => db.assertNotReplaced());
	} finally {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test('assertNotReplaced throws when DB file is deleted (unlinked)', () => {
	const { dir, dbPath, db } = setupTempDb();
	try {
		unlinkSync(dbPath);
		assert.throws(
			() => db.assertNotReplaced(),
			/index was replaced — restart the MCP server/,
		);
	} finally {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test('assertNotReplaced throws when DB file is replaced with a new inode (rename)', () => {
	const { dir, dbPath, db } = setupTempDb();
	try {
		const replacementPath = join(dir, 'replacement.db');
		const db2 = new AppleDocsDB(replacementPath);
		db2.close();

		renameSync(replacementPath, dbPath);

		assert.throws(
			() => db.assertNotReplaced(),
			/index was replaced — restart the MCP server/,
		);
	} finally {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test('assertNotReplaced throws when DB meta build id changes externally', () => {
	const { dir, dbPath, db } = setupTempDb();
	try {
		// Open another connection to update built_at in place
		const externalDb = new AppleDocsDB(dbPath);
		externalDb.setMeta('built_at', '2026-11-10T99:99:99.000Z');
		externalDb.close();

		assert.throws(
			() => db.assertNotReplaced(),
			/index was replaced — restart the MCP server/,
		);
	} finally {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test('get_version hard-fails when DB was replaced or deleted', async () => {
	const { dir, dbPath, db } = setupTempDb();
	const context = {
		client: new AppleDevDocsClient(),
		state: new ServerState(),
		db,
	};

	const versionHandler = buildVersionHandler(context);

	// Healthy check
	const okResult = await versionHandler();
	assert.strictEqual(okResult.isError, undefined);

	// Unlink DB file
	unlinkSync(dbPath);

	await assert.rejects(
		async () => await versionHandler(),
		/index was replaced — restart the MCP server/,
	);

	db.close();
	rmSync(dir, { recursive: true, force: true });
});

test('index_info hard-fails when DB was replaced or deleted', async () => {
	const { dir, dbPath, db } = setupTempDb();
	const context = {
		client: new AppleDevDocsClient(),
		state: new ServerState(),
		db,
	};

	const infoHandler = buildIndexInfoHandler(context);

	// Healthy check
	const okResult = await infoHandler();
	assert.strictEqual(okResult.isError, undefined);

	// Replace DB file
	const replacementPath = join(dir, 'replacement.db');
	const db2 = new AppleDocsDB(replacementPath);
	db2.close();
	renameSync(replacementPath, dbPath);

	await assert.rejects(
		async () => await infoHandler(),
		/index was replaced — restart the MCP server/,
	);

	db.close();
	rmSync(dir, { recursive: true, force: true });
});

test('search_symbols and HybridSearchEngine hard-fail when DB was replaced or deleted', async () => {
	const { dir, dbPath, db } = setupTempDb();
	const searchEngine = new HybridSearchEngine(db);
	const context = {
		client: new AppleDevDocsClient(),
		state: new ServerState(),
		db,
		searchEngine,
	};

	const searchHandler = buildSearchSymbolsHandler(context);

	// Healthy search
	const okResult = await searchHandler({ query: 'View' });
	assert.strictEqual(okResult.isError, undefined);

	// Delete DB file
	unlinkSync(dbPath);

	// Handler call rejects
	await assert.rejects(
		async () => await searchHandler({ query: 'View' }),
		/index was replaced — restart the MCP server/,
	);

	// Direct HybridSearchEngine.search rejects
	await assert.rejects(
		async () => await searchEngine.search('View'),
		/index was replaced — restart the MCP server/,
	);

	// Direct db.queryFTS throws
	assert.throws(
		() => db.queryFTS('View'),
		/index was replaced — restart the MCP server/,
	);

	db.close();
	rmSync(dir, { recursive: true, force: true });
});

test('get_documentation and discover_technologies hard-fail when DB was replaced', async () => {
	const { dir, dbPath, db } = setupTempDb();
	const context = {
		client: new AppleDevDocsClient(),
		state: new ServerState(),
		db,
	};

	const docHandler = buildGetDocumentationHandler(context);
	const discoverHandler = buildDiscoverHandler(context);

	// Delete DB file
	unlinkSync(dbPath);

	await assert.rejects(
		async () => await docHandler({ path: 'View' }),
		/index was replaced — restart the MCP server/,
	);

	await assert.rejects(
		async () => await discoverHandler({}),
		/index was replaced — restart the MCP server/,
	);

	db.close();
	rmSync(dir, { recursive: true, force: true });
});
