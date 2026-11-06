import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { downloadVectors } from '../dist/server/services/download-vectors.js';

test('downloadVectors falls back to secondary mirror when primary mirror fails', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dl-mirror-test-'));
	const mockVectorDbPath = join(dir, 'valid-vectors.db');
	const targetDbPath = join(dir, 'target.db');

	// Create valid mock vector database
	const mockDb = new AppleDocsDB(mockVectorDbPath);
	const vec = new Float32Array(768);
	vec[0] = 0.7;
	mockDb.insertSemanticItem({
		id: 'sym/test',
		framework: 'SwiftUI',
		title: 'TestSymbol',
		kind: 'struct',
		summary: 'A test symbol.',
		path: '/documentation/swiftui/test',
		embedding: vec,
	});
	mockDb.close();

	const validBuffer = readFileSync(mockVectorDbPath);

	// Server 1 (Failing mirror)
	const server1 = createServer((req, res) => {
		res.writeHead(500, { 'Content-Type': 'text/plain' });
		res.end('Server internal error');
	});
	await new Promise((resolve) => server1.listen(0, resolve));
	const port1 = server1.address().port;
	const failUrl = `http://127.0.0.1:${port1}/fail.db`;

	// Server 2 (Healthy mirror)
	const server2 = createServer((req, res) => {
		res.writeHead(200, {
			'content-length': String(validBuffer.length),
			'content-type': 'application/x-sqlite3',
		});
		res.end(validBuffer);
	});
	await new Promise((resolve) => server2.listen(0, resolve));
	const port2 = server2.address().port;
	const successUrl = `http://127.0.0.1:${port2}/success.db`;

	try {
		const res = await downloadVectors({
			url: failUrl,
			mirrors: [successUrl],
			dbPath: targetDbPath,
		});

		assert.strictEqual(res.sourceUrl, successUrl);
		assert.strictEqual(res.importedCount, 1);
		assert.strictEqual(res.totalVectors, 1);

		const targetDb = new AppleDocsDB(targetDbPath);
		assert.strictEqual(targetDb.getEmbeddingStatus().semanticItemCount, 1);
		targetDb.close();
	} finally {
		server1.close();
		server2.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test('downloadVectors validates SHA-256 and rejects corrupted mirror data', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dl-sha-test-'));
	const mockVectorDbPath = join(dir, 'valid-vectors.db');
	const targetDbPath = join(dir, 'target.db');

	const mockDb = new AppleDocsDB(mockVectorDbPath);
	const vec = new Float32Array(768);
	mockDb.insertSemanticItem({
		id: 'sym/verified',
		framework: 'SwiftUI',
		title: 'VerifiedSymbol',
		kind: 'struct',
		summary: 'A verified symbol.',
		path: '/documentation/swiftui/verified',
		embedding: vec,
	});
	mockDb.close();

	const validBuffer = readFileSync(mockVectorDbPath);
	const validSha256 = createHash('sha256').update(validBuffer).digest('hex');

	// Corrupted data server
	const serverCorrupt = createServer((req, res) => {
		const corruptBuffer = Buffer.from('NOT_A_VALID_SQLITE_DATABASE_CORRUPT');
		res.writeHead(200, {
			'content-length': String(corruptBuffer.length),
			'content-type': 'application/x-sqlite3',
		});
		res.end(corruptBuffer);
	});
	await new Promise((resolve) => serverCorrupt.listen(0, resolve));
	const portCorrupt = serverCorrupt.address().port;
	const corruptUrl = `http://127.0.0.1:${portCorrupt}/corrupt.db`;

	// Valid data server
	const serverValid = createServer((req, res) => {
		res.writeHead(200, {
			'content-length': String(validBuffer.length),
			'content-type': 'application/x-sqlite3',
		});
		res.end(validBuffer);
	});
	await new Promise((resolve) => serverValid.listen(0, resolve));
	const portValid = serverValid.address().port;
	const validUrl = `http://127.0.0.1:${portValid}/valid.db`;

	try {
		// Download with expectedSha256: should fail corrupt mirror and succeed on valid mirror
		const result = await downloadVectors({
			url: corruptUrl,
			mirrors: [validUrl],
			dbPath: targetDbPath,
			expectedSha256: validSha256,
		});

		assert.strictEqual(result.sourceUrl, validUrl);
		assert.strictEqual(result.sha256, validSha256);
		assert.strictEqual(result.importedCount, 1);
	} finally {
		serverCorrupt.close();
		serverValid.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test('downloadVectors throws comprehensive error when all mirrors fail', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dl-all-fail-'));
	const targetDbPath = join(dir, 'target.db');

	try {
		await assert.rejects(
			async () => {
				await downloadVectors({
					url: 'http://127.0.0.1:1/nonexistent.db',
					mirrors: ['http://127.0.0.1:2/nonexistent.db'],
					dbPath: targetDbPath,
					timeoutMs: 1000,
				});
			},
			{ message: /Failed to download vectors after trying 2 mirror\(s\)/ },
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('downloadVectors skips download when force is false and vectors already exist', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dl-skip-test-'));
	const targetDbPath = join(dir, 'already-has-vectors.db');

	// Populate target DB with a vector item
	const db = new AppleDocsDB(targetDbPath);
	const v = new Float32Array(768);
	v[0] = 0.5;
	db.insertSemanticItem({
		id: 'existing/sym',
		framework: 'SwiftUI',
		title: 'Existing',
		kind: 'struct',
		summary: 'Existing abstract',
		path: '/documentation/swiftui/existing',
		embedding: v,
	});
	db.close();

	try {
		// Should skip downloading and return 0 imported vectors without contacting any URL
		const res = await downloadVectors({
			url: 'http://127.0.0.1:1/never-called.db',
			dbPath: targetDbPath,
			force: false,
		});

		assert.strictEqual(res.importedCount, 0);
		assert.strictEqual(res.totalVectors, 1);
		assert.strictEqual(res.sourceUrl, '');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('downloadVectors times out and recovers when a mirror stalls mid-stream', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dl-stall-test-'));
	const mockVectorDbPath = join(dir, 'valid-vectors.db');
	const targetDbPath = join(dir, 'target.db');

	const mockDb = new AppleDocsDB(mockVectorDbPath);
	const vec = new Float32Array(768);
	vec[0] = 0.8;
	mockDb.insertSemanticItem({
		id: 'sym/stall-recovery',
		framework: 'SwiftUI',
		title: 'RecoverySymbol',
		kind: 'struct',
		summary: 'A symbol tested after stall.',
		path: '/documentation/swiftui/recovery',
		embedding: vec,
	});
	mockDb.close();

	const validBuffer = readFileSync(mockVectorDbPath);

	// Server 1 stalls after writing headers and partial data
	const serverStall = createServer((req, res) => {
		res.writeHead(200, {
			'content-length': '1000000',
			'content-type': 'application/x-sqlite3',
		});
		res.write(Buffer.from('PARTIAL_START_OF_DATA_THEN_SILENCE'));
		// Intentionally never calls res.end()
	});
	await new Promise((resolve) => serverStall.listen(0, resolve));
	const stallPort = serverStall.address().port;
	const stallUrl = `http://127.0.0.1:${stallPort}/stall.db`;

	// Server 2 sends full valid database
	const serverGood = createServer((req, res) => {
		res.writeHead(200, {
			'content-length': String(validBuffer.length),
			'content-type': 'application/x-sqlite3',
		});
		res.end(validBuffer);
	});
	await new Promise((resolve) => serverGood.listen(0, resolve));
	const goodPort = serverGood.address().port;
	const goodUrl = `http://127.0.0.1:${goodPort}/good.db`;

	try {
		const res = await downloadVectors({
			url: stallUrl,
			mirrors: [goodUrl],
			dbPath: targetDbPath,
			timeoutMs: 500, // Trigger inactivity stall timeout quickly
		});

		assert.strictEqual(res.sourceUrl, goodUrl);
		assert.strictEqual(res.importedCount, 1);
		assert.strictEqual(res.totalVectors, 1);
	} finally {
		serverStall.close();
		serverGood.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
