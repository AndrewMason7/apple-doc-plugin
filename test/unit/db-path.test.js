import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import {
	DEFAULT_DB_RELATIVE_PATH,
	PROJECT_ROOT,
	SEED_DB_RELATIVE_PATH,
	ensureRuntimeDbSeeded,
	isVirtualDbPath,
	resolveDbPath,
	resolveSeedDbPath,
	safeEnsureRuntimeDbSeeded,
} from '../../dist/server/db/db-path.js';

// The repository root, derived from this test file rather than from cwd: the
// resolver must agree with the repo layout whatever directory the caller is in.
const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..',
);

test('resolveSeedDbPath points to data/apple-docs.db while resolveDbPath points to data/apple-docs.runtime.db when writable', () => {
	const seed = resolveSeedDbPath({ env: {} });
	const resolved = resolveDbPath({ env: {}, writableCheck: () => true });

	assert.strictEqual(
		seed,
		path.join(REPO_ROOT, 'data', 'apple-docs.db'),
		'seed must be data/apple-docs.db under the project root',
	);
	assert.strictEqual(
		resolved,
		path.join(REPO_ROOT, 'data', 'apple-docs.runtime.db'),
		'default runtime must be data/apple-docs.runtime.db when project data dir is writable',
	);
	assert.strictEqual(
		PROJECT_ROOT,
		REPO_ROOT,
		'the module must locate the project root itself',
	);
	assert.strictEqual(SEED_DB_RELATIVE_PATH, path.join('data', 'apple-docs.db'));
	assert.strictEqual(
		DEFAULT_DB_RELATIVE_PATH,
		path.join('data', 'apple-docs.runtime.db'),
	);
	assert.ok(
		fs.existsSync(seed),
		'the shipped seed index must be found from resolveSeedDbPath()',
	);
});

test('resolveDbPath falls back to XDG_CACHE_HOME when project data dir is read-only', () => {
	const resolved = resolveDbPath({
		env: { XDG_CACHE_HOME: '/tmp/xdg-cache' },
		writableCheck: () => false,
	});
	assert.strictEqual(
		resolved,
		'/tmp/xdg-cache/apple-docs/apple-docs.runtime.db',
	);

	const fallbackHome = resolveDbPath({
		env: {},
		writableCheck: () => false,
		homeDir: '/home/testuser',
	});
	assert.strictEqual(
		fallbackHome,
		'/home/testuser/.cache/apple-docs/apple-docs.runtime.db',
	);
});

test('APPLE_DOCS_DB_PATH replaces the default', () => {
	assert.strictEqual(
		resolveDbPath({ env: { APPLE_DOCS_DB_PATH: '/srv/indexes/custom.db' } }),
		'/srv/indexes/custom.db',
	);
});

test('a ${extensionPath} prefix expands to the project root', () => {
	assert.strictEqual(
		resolveDbPath({
			env: { APPLE_DOCS_DB_PATH: '${extensionPath}/data/custom.db' },
		}),
		path.join(REPO_ROOT, 'data', 'custom.db'),
		'the MCP config convention must keep working',
	);
});

test('a relative override resolves against the project root, not the cwd', () => {
	assert.strictEqual(
		resolveDbPath({ env: { APPLE_DOCS_DB_PATH: 'data/other.db' } }),
		path.join(REPO_ROOT, 'data', 'other.db'),
	);
});

test('an in-memory path is returned untouched', () => {
	assert.strictEqual(
		resolveDbPath({ env: { APPLE_DOCS_DB_PATH: ':memory:' } }),
		':memory:',
	);
	assert.strictEqual(
		resolveDbPath({
			env: { APPLE_DOCS_DB_PATH: 'file::memory:?cache=shared' },
		}),
		'file::memory:?cache=shared',
	);
	assert.strictEqual(isVirtualDbPath(':memory:'), true);
	assert.strictEqual(isVirtualDbPath('file::memory:?cache=shared'), true);
	assert.strictEqual(isVirtualDbPath('/tmp/apple-docs.db'), false);
});

test('ensureRuntimeDbSeeded copies seed DB, strips stale WAL sidecars, refreshes when built_at changes, and never touches explicit APPLE_DOCS_DB_PATH', () => {
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-seed-'));
	try {
		const dataDir = path.join(tmpRoot, 'data');
		fs.mkdirSync(dataDir, { recursive: true });
		const seedPath = path.join(dataDir, 'apple-docs.db');
		const runtimePath = path.join(dataDir, 'apple-docs.runtime.db');

		const createSeed = (builtAt, marker) => {
			if (fs.existsSync(seedPath)) fs.unlinkSync(seedPath);
			const sdb = new Database(seedPath);
			sdb.exec(
				'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE symbols (id TEXT PRIMARY KEY);',
			);
			sdb
				.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
				.run('built_at', builtAt);
			sdb.prepare('INSERT INTO symbols (id) VALUES (?)').run(marker);
			sdb.close();
		};

		createSeed('2026-11-08T00:00:00.000Z', 'sym-v1');
		fs.writeFileSync(`${runtimePath}-wal`, 'corrupt-stale-wal-bytes');
		fs.writeFileSync(`${runtimePath}-shm`, 'corrupt-stale-shm-bytes');

		const seeded = ensureRuntimeDbSeeded({
			env: {},
			root: tmpRoot,
			writableCheck: () => true,
		});
		assert.strictEqual(seeded, runtimePath);
		assert.ok(fs.existsSync(runtimePath), 'runtime DB must be created');
		assert.strictEqual(
			fs.existsSync(`${runtimePath}-wal`),
			false,
			'stale WAL sidecar must be stripped before seed rename',
		);
		assert.strictEqual(
			fs.existsSync(`${runtimePath}-shm`),
			false,
			'stale SHM sidecar must be stripped before seed rename',
		);

		const rdb1 = new Database(runtimePath, { readonly: true });
		assert.strictEqual(
			rdb1.prepare("SELECT value FROM meta WHERE key = 'built_at'").get().value,
			'2026-11-08T00:00:00.000Z',
		);
		rdb1.close();

		createSeed('2026-11-10T12:00:00.000Z', 'sym-v2');
		ensureRuntimeDbSeeded({
			env: {},
			root: tmpRoot,
			writableCheck: () => true,
		});

		const rdb2 = new Database(runtimePath, { readonly: true });
		assert.strictEqual(
			rdb2.prepare("SELECT value FROM meta WHERE key = 'built_at'").get().value,
			'2026-11-10T12:00:00.000Z',
		);
		assert.strictEqual(
			rdb2.prepare('SELECT id FROM symbols').get().id,
			'sym-v2',
		);
		rdb2.close();

		const customPath = path.join(tmpRoot, 'custom-fixture.db');
		const resCustom = ensureRuntimeDbSeeded({
			env: { APPLE_DOCS_DB_PATH: customPath },
			root: tmpRoot,
		});
		assert.strictEqual(resCustom, customPath);
		assert.strictEqual(
			fs.existsSync(customPath),
			false,
			'custom APPLE_DOCS_DB_PATH must not be overwritten with seed DB',
		);
	} finally {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
});

// I1: the app and every repair script must agree on which file they are
// talking about, or doctor tells a custom-path user to fix a different index.
test('no entry point or script hardcodes the default index path', () => {
	const sources = [
		'scripts/embed-index.ts',
		'scripts/repair-index.ts',
		'scripts/doctor.ts',
		'src/server/app.ts',
	];

	for (const relative of sources) {
		const source = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
		assert.doesNotMatch(
			source,
			/data\/apple-docs(\.runtime)?\.db/,
			`${relative} must resolve the db path through db-path.ts, not a literal`,
		);
		assert.match(
			source,
			/resolveDbPath|ensureRuntimeDbSeeded/i,
			`${relative} must call resolveDbPath() or (safe)EnsureRuntimeDbSeeded()`,
		);
	}

	const buildSource = fs.readFileSync(
		path.join(REPO_ROOT, 'scripts/build-index.ts'),
		'utf8',
	);
	assert.doesNotMatch(buildSource, /data\/apple-docs\.db/);
	assert.match(buildSource, /resolveSeedDbPath/);
});

test('safeEnsureRuntimeDbSeeded degrades gracefully to resolveDbPath when seed copy throws ENOSPC', () => {
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-enospc-'));
	try {
		const dataDir = path.join(tmpRoot, 'data');
		fs.mkdirSync(dataDir, { recursive: true });
		const seedPath = path.join(dataDir, 'apple-docs.db');
		const sdb = new Database(seedPath);
		sdb.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);');
		sdb.close();

		const res = safeEnsureRuntimeDbSeeded({
			env: {},
			root: tmpRoot,
			writableCheck: () => true,
			copyFn: () => {
				const err = new Error('ENOSPC: no space left on device');
				err.code = 'ENOSPC';
				throw err;
			},
		});
		assert.strictEqual(res, path.join(dataDir, 'apple-docs.runtime.db'));
	} finally {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
});

test('README documents data/apple-docs.runtime.db and XDG_CACHE_HOME fallback', () => {
	const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
	assert.match(readme, /data\/apple-docs\.runtime\.db/);
	assert.match(readme, /XDG_CACHE_HOME/);
});
