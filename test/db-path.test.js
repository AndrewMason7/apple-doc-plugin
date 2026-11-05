import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	DEFAULT_DB_RELATIVE_PATH,
	PROJECT_ROOT,
	isVirtualDbPath,
	resolveDbPath,
} from '../dist/server/db/db-path.js';

// The repository root, derived from this test file rather than from cwd: the
// resolver must agree with the repo layout whatever directory the caller is in.
const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
);

test('the default resolves to the shipped index next to the project root', () => {
	const resolved = resolveDbPath({ env: {} });

	assert.strictEqual(
		resolved,
		path.join(REPO_ROOT, 'data', 'apple-docs.db'),
		'default must be data/apple-docs.db under the project root',
	);
	assert.strictEqual(
		PROJECT_ROOT,
		REPO_ROOT,
		'the module must locate the project root itself',
	);
	assert.strictEqual(
		DEFAULT_DB_RELATIVE_PATH,
		path.join('data', 'apple-docs.db'),
	);
	assert.ok(
		fs.existsSync(resolved),
		'the shipped index must be found from the resolver, not assumed',
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

// I1: the app and every repair script must agree on which file they are
// talking about, or doctor tells a custom-path user to fix a different index.
test('no entry point or script hardcodes the default index path', () => {
	const sources = [
		'scripts/build-index.ts',
		'scripts/embed-index.ts',
		'scripts/repair-index.ts',
		'scripts/doctor.ts',
		'src/server/app.ts',
	];

	for (const relative of sources) {
		const source = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
		assert.doesNotMatch(
			source,
			/data\/apple-docs\.db/,
			`${relative} must resolve the db path through db-path.ts, not a literal`,
		);
		assert.match(
			source,
			/resolveDbPath/,
			`${relative} must call resolveDbPath()`,
		);
	}
});
