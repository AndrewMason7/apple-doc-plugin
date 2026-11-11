import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import { areEmbeddingModelsCompatible } from '../../dist/server/services/search/embedding-provider.js';
import { GeminiSemanticSearch } from '../../dist/server/services/search/semantic-search.js';
import { LocalGemmaEmbeddingProvider } from '../../dist/server/services/search/local-gemma-provider.js';
import { UnavailableEmbeddingProvider } from '../../dist/server/services/search/provider-factory.js';
import { embedSymbols } from '../../dist/server/services/symbol-embeddings.js';
import { HybridSearchEngine } from '../../dist/server/services/search/hybrid-search.js';
import { buildSearchSymbolsHandler } from '../../dist/server/handlers/search-symbols.js';
import {
	buildVersionHandler,
	buildIndexInfoHandler,
} from '../../dist/server/handlers/version.js';
import { runDoctor } from '../../dist/server/services/doctor.js';
import { ServerState } from '../../dist/server/state.js';
import {
	downloadVectors,
	findLocalVectorArtifact,
} from '../../dist/server/services/download-vectors.js';
import { exportVectors } from '../../dist/server/services/export-vectors.js';

const unitVec = (dims = 768, index = 0) => {
	const arr = new Float32Array(dims);
	arr[index % dims] = 1.0;
	return arr;
};

const makeMockProvider = (id, modelId, dims = 768) => ({
	id,
	modelId,
	dimensions: dims,
	minSimilarity: 0.5,
	minSimilarityPreferred: 0.5,
	isAvailable: () => true,
	embedQuery: async () => unitVec(dims, 0),
	embedDocument: async () => unitVec(dims, 0),
});

test('providers expose canonical modelId and areEmbeddingModelsCompatible normalizes prefixes', () => {
	const gemini = new GeminiSemanticSearch('test-key');
	const gemma = new LocalGemmaEmbeddingProvider('/nonexistent/model.gguf');
	const none = new UnavailableEmbeddingProvider();

	assert.strictEqual(gemini.modelId, 'gemini-embedding-2');
	assert.strictEqual(gemma.modelId, 'embeddinggemma-2');
	assert.strictEqual(none.modelId, 'none');

	assert.strictEqual(
		areEmbeddingModelsCompatible(
			'models/gemini-embedding-2',
			'gemini-embedding-2',
		),
		true,
	);
	assert.strictEqual(
		areEmbeddingModelsCompatible('gemini-embedding-2', 'embeddinggemma-2'),
		false,
	);
	assert.strictEqual(
		areEmbeddingModelsCompatible(null, 'embeddinggemma-2'),
		true,
	);
	assert.strictEqual(
		areEmbeddingModelsCompatible('unknown', 'embeddinggemma-2'),
		true,
	);
	assert.strictEqual(
		areEmbeddingModelsCompatible('gemini-embedding-2', 'none'),
		true,
	);
});

test('embedSymbols stamps embedding_model and refuses mixed-model writes without force: true', async () => {
	const db = new AppleDocsDB(':memory:');
	try {
		db.insertSymbol({
			id: '/documentation/swiftui/view',
			framework: 'SwiftUI',
			title: 'View',
			kind: 'protocol',
			abstract: 'A view protocol.',
			path: '/documentation/swiftui/view',
			platforms: ['iOS 13.0+'],
			isPrimaryType: true,
		});

		const geminiMock = makeMockProvider('gemini', 'gemini-embedding-2');
		await embedSymbols(db, geminiMock);

		assert.strictEqual(db.getStoredEmbeddingModel(), 'gemini-embedding-2');
		assert.strictEqual(db.getMeta('embedding_provider'), 'gemini');
		assert.strictEqual(db.getSemanticItemCount(), 1);

		const gemmaMock = makeMockProvider('local-gguf', 'embeddinggemma-2');
		await assert.rejects(
			() => embedSymbols(db, gemmaMock),
			/model mismatch.*--force/i,
		);

		// With force: true, clears prior model's vectors and updates provenance
		await embedSymbols(db, gemmaMock, { force: true });
		assert.strictEqual(db.getStoredEmbeddingModel(), 'embeddinggemma-2');
		assert.strictEqual(db.getMeta('embedding_provider'), 'local-gguf');
		assert.strictEqual(db.getSemanticItemCount(), 1);

		// Legacy unprovenanced DB (existing vectors, storedModel === null) must reject non-Gemini writes without force: true
		const legacyDb = new AppleDocsDB(':memory:');
		try {
			legacyDb.insertSymbol({
				id: '/documentation/swiftui/button',
				framework: 'SwiftUI',
				title: 'Button',
				kind: 'struct',
				abstract: 'A button control.',
				path: '/documentation/swiftui/button',
				platforms: ['iOS 13.0+'],
				isPrimaryType: true,
			});
			legacyDb.insertSymbol({
				id: '/documentation/swiftui/text',
				framework: 'SwiftUI',
				title: 'Text',
				kind: 'struct',
				abstract: 'A text view.',
				path: '/documentation/swiftui/text',
				platforms: ['iOS 13.0+'],
				isPrimaryType: true,
			});
			legacyDb.insertSemanticItem({
				id: 'sym-/documentation/swiftui/button',
				framework: 'SwiftUI',
				title: 'Button',
				kind: 'struct',
				summary: 'A button control.',
				path: '/documentation/swiftui/button',
				embedding: unitVec(768, 0),
			});
			assert.strictEqual(legacyDb.getStoredEmbeddingModel(), null);

			await assert.rejects(
				() => embedSymbols(legacyDb, gemmaMock),
				/unprovenanced|model mismatch.*--force/i,
			);
			await embedSymbols(legacyDb, gemmaMock, { force: true });
			assert.strictEqual(
				legacyDb.getStoredEmbeddingModel(),
				'embeddinggemma-2',
			);
			assert.strictEqual(legacyDb.getSemanticItemCount(), 2);
		} finally {
			legacyDb.close();
		}
	} finally {
		db.close();
	}
});

test('768-d query model mismatch skips cross-space cosine fusion and surfaces explicit banners in search, version, index_info, and doctor', async () => {
	const db = new AppleDocsDB(':memory:');
	try {
		db.setMeta('built_at', new Date().toISOString());
		for (let i = 0; i < 105; i++) {
			const id = `/documentation/swiftui/sym${i}`;
			db.insertSymbol({
				id,
				framework: 'SwiftUI',
				title: i === 0 ? 'NavigationSplitView' : `Sym${i}`,
				kind: 'struct',
				abstract:
					i === 0 ? 'A multi-column split view.' : `Helper symbol number ${i}.`,
				path: id,
				platforms: ['iOS 16.0+'],
				isPrimaryType: true,
			});
			db.insertSemanticItem({
				id: `sym-${id}`,
				framework: 'SwiftUI',
				title: i === 0 ? 'NavigationSplitView' : `Sym${i}`,
				kind: 'struct',
				summary: 'A multi-column split view.',
				path: id,
				embedding: unitVec(768, 0),
			});
		}
		db.setMeta('embedding_model', 'gemini-embedding-2');
		db.setMeta('embedding_provider', 'gemini');

		const gemmaMock = makeMockProvider('local-gguf', 'embeddinggemma-2', 768);
		const engine = new HybridSearchEngine(db, { embeddingProvider: gemmaMock });

		const hits = await engine.search('NavigationSplitView', {
			preferSemantic: true,
		});
		assert.ok(hits.length > 0);
		assert.ok(
			hits.every((h) => h.source === 'fts'),
			'All hits must remain lexical FTS when 768-d models disagree',
		);

		const ctx = {
			client: { extractText: () => '' },
			state: new ServerState(),
			db,
			searchEngine: engine,
		};

		const searchRes = await buildSearchSymbolsHandler(ctx)({
			query: 'NavigationSplitView',
			preferSemantic: true,
		});
		const searchText = searchRes.content[0].text;
		assert.match(
			searchText,
			/embedding model mismatch.*gemini-embedding-2.*embeddinggemma-2/i,
		);

		const verText = (await buildVersionHandler(ctx)()).content[0].text;
		assert.match(verText, /model mismatch/i);

		const infoText = (await buildIndexInfoHandler(ctx)()).content[0].text;
		assert.match(infoText, /model mismatch/i);

		const docReport = runDoctor({
			db,
			dbPath: ':memory:',
			provider: gemmaMock,
			nodeVersion: 'v24.0.0',
		});
		const dimOrModelCheck = docReport.checks.find(
			(c) => c.status === 'fail' && /model mismatch/i.test(c.detail),
		);
		assert.ok(
			dimOrModelCheck,
			'Doctor must fail loudly when stored 768-d model mismatches active 768-d provider',
		);
	} finally {
		db.close();
	}
});

test('exportVectors writes embeddingModel into manifest/meta and downloadVectors stamps pinned v1 artifact while leaving unpinned v1 unknown', async () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-prov-'));
	try {
		const srcPath = path.join(tmpDir, 'src.db');
		const srcDb = new AppleDocsDB(srcPath);
		srcDb.insertSemanticItem({
			id: 'sym-/documentation/swiftui/view',
			framework: 'SwiftUI',
			title: 'View',
			kind: 'protocol',
			summary: 'A view.',
			path: '/documentation/swiftui/view',
			embedding: unitVec(768, 1),
		});
		srcDb.setMeta('embedding_model', 'gemini-embedding-2');
		srcDb.setMeta('embedding_provider', 'gemini');
		srcDb.close();

		const exportedPath = path.join(tmpDir, 'exported-768d.db');
		const expRes = await exportVectors({
			sourceDbPath: srcPath,
			outputPath: exportedPath,
			force: true,
		});
		assert.strictEqual(expRes.manifest.embeddingModel, 'gemini-embedding-2');
		assert.strictEqual(expRes.manifest.embeddingProvider, 'gemini');

		// Unpinned legacy v1 bundle without embedding_model in meta -> remains null/'unknown'
		const legacyV1Path = path.join(tmpDir, 'legacy-v1.db');
		const legDb = new AppleDocsDB(legacyV1Path);
		legDb.insertSemanticItem({
			id: 'sym-/documentation/swiftui/button',
			framework: 'SwiftUI',
			title: 'Button',
			kind: 'struct',
			summary: 'A button.',
			path: '/documentation/swiftui/button',
			embedding: unitVec(768, 2),
		});
		legDb.close();

		const destUnpinnedPath = path.join(tmpDir, 'dest-unpinned.db');
		const destUnpinnedDb = new AppleDocsDB(destUnpinnedPath);
		destUnpinnedDb.importVectorsFromDb(legacyV1Path);
		assert.strictEqual(destUnpinnedDb.getStoredEmbeddingModel(), null);
		destUnpinnedDb.close();

		// Pinned shipped bundle -> stamps gemini-embedding-2 (if bundled artifact present)
		if (findLocalVectorArtifact()) {
			const destPinnedPath = path.join(tmpDir, 'dest-pinned.db');
			const initPinned = new AppleDocsDB(destPinnedPath);
			initPinned.close();
			await downloadVectors({ dbPath: destPinnedPath, force: true });
			const verifyPinned = new AppleDocsDB(destPinnedPath, { readonly: true });
			assert.strictEqual(
				verifyPinned.getStoredEmbeddingModel(),
				'gemini-embedding-2',
			);
			verifyPinned.close();
		}

		// I2: Importing a subset bundle of a DIFFERENT model clears stale rows from the prior model
		const mixedDestPath = path.join(tmpDir, 'mixed-dest.db');
		const mixedDest = new AppleDocsDB(mixedDestPath);
		mixedDest.insertSemanticItem({
			id: 'sym-/documentation/swiftui/view',
			framework: 'SwiftUI',
			title: 'View',
			kind: 'protocol',
			summary: 'A view.',
			path: '/documentation/swiftui/view',
			embedding: unitVec(768, 0),
		});
		mixedDest.insertSemanticItem({
			id: 'sym-/documentation/swiftui/text',
			framework: 'SwiftUI',
			title: 'Text',
			kind: 'struct',
			summary: 'A text.',
			path: '/documentation/swiftui/text',
			embedding: unitVec(768, 1),
		});
		mixedDest.setMeta('embedding_model', 'gemini-embedding-2');

		const gemmaBundlePath = path.join(tmpDir, 'gemma-subset.db');
		const gemmaBundle = new AppleDocsDB(gemmaBundlePath);
		gemmaBundle.insertSemanticItem({
			id: 'sym-/documentation/swiftui/view',
			framework: 'SwiftUI',
			title: 'View',
			kind: 'protocol',
			summary: 'A view.',
			path: '/documentation/swiftui/view',
			embedding: unitVec(768, 3),
		});
		gemmaBundle.setMeta('embedding_model', 'embeddinggemma-2');
		gemmaBundle.setMeta('embedding_provider', 'local-gguf');
		gemmaBundle.close();

		mixedDest.importVectorsFromDb(gemmaBundlePath);
		assert.strictEqual(
			mixedDest.getSemanticItemCount(),
			1,
			'Stale Gemini row must be purged before importing Gemma subset bundle',
		);
		assert.strictEqual(mixedDest.getStoredEmbeddingModel(), 'embeddinggemma-2');
		mixedDest.close();

		// M1: Fallback provenance stamps gemini-embedding-2 ONLY when SHA-256 matches VECTOR_ARTIFACT_SHA256
		const http = await import('node:http');
		const srv = http.createServer((_req, res) => {
			fs.createReadStream(legacyV1Path).pipe(res);
		});
		await new Promise((r) => srv.listen(0, '127.0.0.1', r));
		const port = srv.address().port;
		try {
			const fakePinnedDestPath = path.join(tmpDir, 'fake-pinned-dest.db');
			const fakeInit = new AppleDocsDB(fakePinnedDestPath);
			fakeInit.close();
			await downloadVectors({
				dbPath: fakePinnedDestPath,
				url: `http://127.0.0.1:${port}/legacy-v1.db`,
				expectedSha256: null,
				force: true,
			});
			const checkFake = new AppleDocsDB(fakePinnedDestPath, { readonly: true });
			assert.strictEqual(
				checkFake.getStoredEmbeddingModel(),
				null,
				'Unmatched SHA-256 must never receive the gemini-embedding-2 fallback stamp',
			);
			checkFake.close();
		} finally {
			srv.close();
		}
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});
