import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { FileCache } from '../dist/apple-client/cache/file-cache.js';
import { MemoryCache } from '../dist/apple-client/cache/memory-cache.js';

test('FileCache: detects corrupted JSON, unlinks bad file, and returns undefined instead of crashing', async () => {
	const tmpDir = join(process.cwd(), '.cache-test-' + Date.now());
	await fs.mkdir(tmpDir, { recursive: true });
	const badFilePath = join(tmpDir, '.cache', 'bad__sym.json');
	await fs.mkdir(join(tmpDir, '.cache'), { recursive: true });
	await fs.writeFile(badFilePath, '{ this is corrupted json! ');

	const fileCache = new FileCache(tmpDir);
	const result = await fileCache.loadSymbol('bad/sym');
	assert.equal(result, undefined);

	// File should have been unlinked/removed
	const exists = await fs
		.access(badFilePath)
		.then(() => true)
		.catch(() => false);
	assert.equal(exists, false);

	await fs.rm(tmpDir, { recursive: true, force: true });
});

test('MemoryCache: evicts oldest entries when exceeding max capacity', () => {
	const mem = new MemoryCache(60_000, 3); // cap at 3
	mem.set('k1', 1);
	mem.set('k2', 2);
	mem.set('k3', 3);
	mem.set('k4', 4); // should evict k1
	assert.equal(mem.get('k1'), undefined);
	assert.equal(mem.get('k2'), 2);
	assert.equal(mem.get('k3'), 3);
	assert.equal(mem.get('k4'), 4);
});
