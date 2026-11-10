import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import {
	findLocalVectorArtifact,
	autoImportBundledVectors,
	isAutoImportInFlight,
	setAutoImportInFlightForTest,
} from '../../dist/server/services/download-vectors.js';

test('Zero-step hybrid: findLocalVectorArtifact discovers bundled gzip artifact', () => {
	const artifact = findLocalVectorArtifact();
	assert.ok(artifact, 'findLocalVectorArtifact should find bundled artifact');
	assert.ok(
		artifact.endsWith('apple-docs-vectors-768d.db.gz') ||
			artifact.endsWith('apple-docs-vectors-768d.db'),
		`Expected vector artifact, got: ${artifact}`,
	);
	assert.ok(
		fs.existsSync(artifact),
		`Artifact file must exist on disk: ${artifact}`,
	);
});

test('Zero-step hybrid: autoImportBundledVectors decompresses and imports into empty DB', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'apple-docs-zero-step-'),
	);
	const dbPath = path.join(tempDir, 'test-target.db');

	const db = new AppleDocsDB(dbPath);
	db.insertSymbol({
		id: '/documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A type that represents part of the user interface.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});

	assert.strictEqual(db.getSemanticItemCount(), 0);

	try {
		const imported = await autoImportBundledVectors({ dbPath, db });
		assert.strictEqual(imported, true, 'First auto-import should succeed');

		const newCount = db.getSemanticItemCount();
		assert.strictEqual(newCount, 19473, 'Should import exactly 19,473 vectors');
		assert.strictEqual(
			db.hasEmbeddings(),
			true,
			'hasEmbeddings should be true',
		);

		// Second call should detect existing vectors and skip
		const secondRun = await autoImportBundledVectors({ dbPath, db });
		assert.strictEqual(
			secondRun,
			false,
			'Second run should skip existing vectors',
		);
	} finally {
		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test('Zero-step hybrid: APPLE_DOCS_SKIP_AUTO_IMPORT disables automatic import', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'apple-docs-zero-step-skip-'),
	);
	const dbPath = path.join(tempDir, 'test-skip.db');

	const db = new AppleDocsDB(dbPath);
	db.insertSymbol({
		id: '/documentation/swiftui/button',
		framework: 'SwiftUI',
		title: 'Button',
		kind: 'struct',
		abstract: 'A button.',
		path: '/documentation/swiftui/button',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});

	process.env.APPLE_DOCS_SKIP_AUTO_IMPORT = 'true';
	try {
		const imported = await autoImportBundledVectors({ dbPath, db });
		assert.strictEqual(imported, false, 'Should be skipped when env flag set');
		assert.strictEqual(db.getSemanticItemCount(), 0);
	} finally {
		delete process.env.APPLE_DOCS_SKIP_AUTO_IMPORT;
		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test('Zero-step hybrid: search_symbols handler lazily imports bundled vectors when preferSemantic is true', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'apple-docs-zero-step-handler-'),
	);
	const dbPath = path.join(tempDir, 'test-handler.db');

	const db = new AppleDocsDB(dbPath);
	db.insertSymbol({
		id: '/documentation/swiftui/navigationsplitview',
		framework: 'SwiftUI',
		title: 'NavigationSplitView',
		kind: 'struct',
		abstract: 'A view that presents views in two or three columns.',
		path: '/documentation/swiftui/navigationsplitview',
		platforms: ['iOS 16.0+'],
		isPrimaryType: true,
	});

	const { HybridSearchEngine } =
		await import('../../dist/server/services/search/hybrid-search.js');
	const { buildSearchSymbolsHandler } =
		await import('../../dist/server/handlers/search-symbols.js');
	const { ServerState } = await import('../../dist/server/state.js');

	const searchEngine = new HybridSearchEngine(db, { apiKey: null });
	const state = new ServerState();
	const handler = buildSearchSymbolsHandler({
		client: { extractText: () => '' },
		state,
		db,
		searchEngine,
	});

	assert.strictEqual(db.getSemanticItemCount(), 0);

	try {
		const res = await handler({
			query: 'NavigationSplitView',
			preferSemantic: true,
		});
		assert.strictEqual(res.isError, undefined);
		assert.strictEqual(
			db.getSemanticItemCount(),
			19473,
			'Handler must lazily trigger bundled vector import',
		);
		const text = res.content[0].text;
		assert.ok(
			!text.includes('Semantic index empty'),
			'Should not show semantic index empty warning after auto-import',
		);
	} finally {
		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test('Zero-step hybrid: get_version, index_info, and doctor report hydrating state while background import is in flight', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'apple-docs-hydrating-status-'),
	);
	const dbPath = path.join(tempDir, 'hydrating.db');
	const db = new AppleDocsDB(dbPath);
	db.insertSymbol({
		id: '/documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A type that represents part of the user interface.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});
	db.setMeta('built_at', new Date().toISOString());

	const { buildVersionHandler, buildIndexInfoHandler } =
		await import('../../dist/server/handlers/version.js');
	const { runDoctor } = await import('../../dist/server/services/doctor.js');
	const { GeminiSemanticSearch } =
		await import('../../dist/server/services/search/semantic-search.js');
	const { ServerState } = await import('../../dist/server/state.js');

	let resolvePending;
	const pending = new Promise((r) => {
		resolvePending = r;
	});

	setAutoImportInFlightForTest(pending);
	try {
		assert.strictEqual(isAutoImportInFlight(), true);

		const ctx = {
			client: { extractText: () => '' },
			state: new ServerState(),
			db,
			searchEngine: {
				embeddingProvider: new GeminiSemanticSearch('test-key'),
			},
		};
		const verRes = await buildVersionHandler(ctx)();
		const verText = verRes.content[0].text;
		assert.match(verText, /Hydrating bundled 768-d vectors in background/i);
		assert.doesNotMatch(verText, /npm run download-vectors/i);

		const infoRes = await buildIndexInfoHandler(ctx)();
		const infoText = infoRes.content[0].text;
		assert.match(infoText, /\*\*Mode:\*\*\s*hydrating/i);
		assert.doesNotMatch(infoText, /npm run download-vectors/i);

		const report = runDoctor({
			db,
			dbPath,
			provider: new GeminiSemanticSearch('test-key'),
			nodeVersion: 'v24.0.0',
			hydrating: true,
		});
		assert.strictEqual(report.failures, 0);
		assert.strictEqual(report.warnings, 0);
		const semCheck = report.checks.find((c) => c.id === 'semantic_layer');
		assert.strictEqual(semCheck?.status, 'ok');
		assert.match(semCheck?.detail ?? '', /hydrating bundled 768-d vectors/i);
	} finally {
		resolvePending(true);
		setAutoImportInFlightForTest(null);
		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
