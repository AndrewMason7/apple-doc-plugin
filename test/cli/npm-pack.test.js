import assert from 'node:assert';
import test from 'node:test';
import { execSync } from 'node:child_process';
import { ensureRuntimeDbSeeded } from '../../dist/server/db/db-path.js';

test('npm pack: tarball bundle meets size ceiling and file allowlist', () => {
	ensureRuntimeDbSeeded();
	const output = execSync('npm pack --dry-run --json', { encoding: 'utf8' });
	const parsed = JSON.parse(output);
	const packInfo = Array.isArray(parsed)
		? parsed[0]
		: parsed.name
			? parsed
			: Object.values(parsed)[0];

	assert.strictEqual(packInfo.name, 'apple-doc-plugin');
	assert.ok(
		packInfo.size < 75 * 1024 * 1024,
		`Tarball size ${packInfo.size} exceeds 75 MB limit`,
	);

	const filenames = packInfo.files.map((f) => f.path);

	// Required runtime files
	assert.ok(
		filenames.includes('data/apple-docs.db'),
		'Missing SQLite database',
	);
	assert.ok(
		filenames.includes('assets/apple-docs-vectors-768d.db.gz'),
		'Missing bundled vector artifact',
	);
	assert.ok(filenames.includes('assets/logo.png'), 'Missing asset logo');
	assert.ok(filenames.includes('dist/index.js'), 'Missing entrypoint');
	assert.ok(
		filenames.includes('skills/apple-docs/SKILL.md'),
		'Missing skill definition',
	);
	assert.ok(filenames.includes('rules/AGENTS.md'), 'Missing rules definition');
	assert.ok(filenames.includes('LICENSE'), 'Missing LICENSE');
	assert.ok(filenames.includes('README.md'), 'Missing README.md');

	// Excluded development and runtime-hydrated files
	assert.ok(
		!filenames.some((f) => f.includes('runtime.db')),
		'Included runtime-hydrated SQLite database in published tarball',
	);
	assert.ok(
		!filenames.some((f) => f.startsWith('test/')),
		'Included test files',
	);
	assert.ok(
		!filenames.some((f) => f.endsWith('.bak')),
		'Included backup files',
	);
	assert.ok(!filenames.some((f) => f.includes('.env')), 'Included .env file');
	assert.ok(
		!filenames.some((f) => f.startsWith('scripts/')),
		'Included scripts directory in published tarball',
	);
});
