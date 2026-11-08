import assert from 'node:assert';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import { downloadModel } from '../../dist/server/services/download-model.js';
import { downloadVectors } from '../../dist/server/services/download-vectors.js';
import { runDownloadModelCli } from '../../dist/cli/commands/download-model.js';
import { runDownloadVectorsCli } from '../../dist/cli/commands/download-vectors.js';

test('downloadModel skips when destination exists and force is false', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'model-test-'));
	const dest = join(dir, 'test-model.gguf');
	writeFileSync(dest, 'dummy model content');

	try {
		const res = await downloadModel({
			destination: dest,
			force: false,
		});
		assert.strictEqual(res.skipped, true);
		assert.strictEqual(res.bytesDownloaded, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('downloadModel streams and saves file with progress', async () => {
	const testPayload = Buffer.from('GGUF_TEST_MODEL_STREAMING_DATA_12345');
	const server = createServer((req, res) => {
		res.writeHead(200, {
			'content-length': String(testPayload.length),
			'content-type': 'application/octet-stream',
		});
		res.end(testPayload);
	});

	await new Promise((resolve) => server.listen(0, resolve));
	const port = server.address().port;
	const url = `http://127.0.0.1:${port}/model.gguf`;

	const dir = mkdtempSync(join(tmpdir(), 'model-dl-'));
	const dest = join(dir, 'downloaded.gguf');

	let progressCalled = false;

	try {
		const res = await downloadModel({
			url,
			destination: dest,
			force: true,
			onProgress: (p) => {
				progressCalled = true;
				assert.ok(p.loaded > 0);
			},
		});

		assert.strictEqual(res.skipped, false);
		assert.strictEqual(res.bytesDownloaded, testPayload.length);
		assert.ok(existsSync(dest));
		assert.strictEqual(progressCalled, true);
	} finally {
		server.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test('AppleDocsDB.importVectorsFromDb imports semantic items from external DB', () => {
	const dir = mkdtempSync(join(tmpdir(), 'import-vec-'));
	const srcDbPath = join(dir, 'source.db');
	const targetDbPath = join(dir, 'target.db');

	try {
		// 1. Create source db with semantic items
		const srcDb = new AppleDocsDB(srcDbPath);
		const vector = new Float32Array(768);
		vector[0] = 0.5;
		srcDb.insertSemanticItem({
			id: 'doc/swiftui/view',
			framework: 'SwiftUI',
			title: 'View',
			kind: 'protocol',
			summary: 'A view protocol.',
			path: '/documentation/swiftui/view',
			embedding: vector,
		});
		srcDb.close();

		// 2. Target db initially has 0 semantic items
		const targetDb = new AppleDocsDB(targetDbPath);
		assert.strictEqual(targetDb.getEmbeddingStatus().semanticItemCount, 0);

		// 3. Import vectors from source db
		const imported = targetDb.importVectorsFromDb(srcDbPath);
		assert.strictEqual(imported, 1);

		const status = targetDb.getEmbeddingStatus();
		assert.strictEqual(status.semanticItemCount, 1);
		assert.strictEqual(targetDb.getMeta('semantic_item_count'), '1');
		assert.ok(targetDb.getMeta('embedded_at'));

		targetDb.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('downloadVectors downloads external vector DB and merges into target DB', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dl-vectors-'));
	const mockVectorDbPath = join(dir, 'remote-vectors.db');
	const targetDbPath = join(dir, 'apple-docs.db');

	// Populate mock remote db
	const mockDb = new AppleDocsDB(mockVectorDbPath);
	for (let i = 0; i < 5; i++) {
		const vec = new Float32Array(768);
		vec[0] = i * 0.1;
		mockDb.insertSemanticItem({
			id: `sym-${i}`,
			framework: 'SwiftUI',
			title: `Symbol${i}`,
			kind: 'struct',
			summary: `Symbol summary ${i}`,
			path: `/documentation/swiftui/symbol${i}`,
			embedding: vec,
		});
	}
	mockDb.close();

	const { readFileSync } = await import('node:fs');
	const fileBuffer = readFileSync(mockVectorDbPath);

	const server = createServer((req, res) => {
		res.writeHead(200, {
			'content-length': String(fileBuffer.length),
			'content-type': 'application/x-sqlite3',
		});
		res.end(fileBuffer);
	});

	await new Promise((resolve) => server.listen(0, resolve));
	const port = server.address().port;
	const url = `http://127.0.0.1:${port}/vectors.db`;

	try {
		let progressReported = false;
		const result = await downloadVectors({
			url,
			dbPath: targetDbPath,
			onProgress: (p) => {
				progressReported = true;
			},
		});

		assert.strictEqual(result.importedCount, 5);
		assert.strictEqual(result.totalVectors, 5);
		assert.strictEqual(progressReported, true);

		// Verify target DB has the items
		const targetDb = new AppleDocsDB(targetDbPath);
		assert.strictEqual(targetDb.getEmbeddingStatus().semanticItemCount, 5);
		targetDb.close();
	} finally {
		server.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test('runDownloadModelCli --help prints usage and exits 0', async () => {
	let output = '';
	const code = await runDownloadModelCli({
		argv: ['--help'],
		print: (text) => {
			output += text;
		},
	});
	assert.strictEqual(code, 0);
	assert.ok(output.includes('Usage: apple-doc-plugin download-model'));
	assert.ok(output.includes('--force'));
});

test('runDownloadModelCli handles failure gracefully and exits 1', async () => {
	let errOutput = '';
	const dest = join(tmpdir(), `nonexistent-model-${Date.now()}.gguf`);
	const code = await runDownloadModelCli({
		argv: [
			'--force',
			'--dest',
			dest,
			'--url',
			'http://127.0.0.1:1/nonexistent.gguf',
		],
		print: () => {},
		eprint: (text) => {
			errOutput += text;
		},
	});
	assert.strictEqual(code, 1);
	assert.ok(errOutput.includes('Error:'));
});

test('runDownloadVectorsCli --help prints usage and exits 0', async () => {
	let output = '';
	const code = await runDownloadVectorsCli({
		argv: ['--help'],
		print: (text) => {
			output += text;
		},
	});
	assert.strictEqual(code, 0);
	assert.ok(output.includes('Usage: apple-doc-plugin download-vectors'));
	assert.ok(output.includes('--db'));
});

test('runDownloadVectorsCli handles failure gracefully and exits 1', async () => {
	let errOutput = '';
	// Pin an isolated target: without --db this resolves to the real project
	// index, and a database that already holds vectors short-circuits the
	// download, so the CLI would exit 0 regardless of the failing URL.
	const code = await runDownloadVectorsCli({
		argv: [
			'--url',
			'http://127.0.0.1:1/nonexistent.db',
			'--db',
			join(tmpdir(), `dl-cli-fail-${Date.now()}.db`),
		],
		print: () => {},
		eprint: (text) => {
			errOutput += text;
		},
	});
	assert.strictEqual(code, 1);
	assert.ok(errOutput.includes('Error:'));
});
