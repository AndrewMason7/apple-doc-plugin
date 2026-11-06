import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AppleDocsDB } from '../../dist/server/db/database.js';
import { runDoctorCli } from '../../dist/cli/commands/doctor.js';

const tmpDb = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-cli-'));
	const db = new AppleDocsDB(path.join(dir, 'test.db'));
	db.insertSymbol({
		id: '/documentation/swiftui/type0',
		framework: 'SwiftUI',
		title: 'Type0',
		kind: 'struct',
		abstract: 'x',
		path: '/documentation/swiftui/type0',
		platforms: ['iOS'],
		isPrimaryType: true,
	});
	db.close();
	return path.join(dir, 'test.db');
};

const unavailable = {
	id: 'unavailable',
	dimensions: 0,
	isAvailable: () => false,
	embedQuery: async () => null,
	embedDocument: async () => null,
};

test('runDoctorCli exits 0 and prints the report for a healthy index', async () => {
	const dbPath = tmpDb();
	let printed = '';
	const code = await runDoctorCli({
		argv: [],
		dbPath,
		provider: unavailable,
		nodeVersion: 'v22.0.0',
		print: (s) => (printed += s),
	});

	assert.strictEqual(code, 0);
	assert.match(printed, /✔ /);
	assert.match(printed, /Index file/);
});

test('runDoctorCli exits 1 when a check fails', async () => {
	let printed = '';
	const code = await runDoctorCli({
		argv: [],
		dbPath: '/nonexistent/apple-docs.db',
		provider: unavailable,
		nodeVersion: 'v22.0.0',
		print: (s) => (printed += s),
	});

	assert.strictEqual(code, 1);
	assert.match(printed, /✖ Index file/);
	assert.match(printed, /npm run build:index/);
});

test('--json emits a parseable report and no icons', async () => {
	let printed = '';
	const code = await runDoctorCli({
		argv: ['--json'],
		dbPath: tmpDb(),
		provider: unavailable,
		nodeVersion: 'v22.0.0',
		print: (s) => (printed += s),
	});

	assert.strictEqual(code, 0);
	const parsed = JSON.parse(printed);
	assert.strictEqual(parsed.ok, true);
	assert.ok(Array.isArray(parsed.checks));
	// The name promises 'no icons': assert the absence, or an implementation
	// that leaks the human formatter into --json would still pass.
	assert.ok(
		!/[✔⚠✖]/.test(printed),
		'--json output must not contain status icons',
	);
});

test('runDoctorCli exits 1 when the index exists but cannot be opened', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-cli-bad-'));
	const dbPath = path.join(dir, 'apple-docs.db');
	fs.writeFileSync(dbPath, 'this is not a sqlite database');

	let printed = '';
	const code = await runDoctorCli({
		argv: [],
		dbPath,
		provider: unavailable,
		nodeVersion: 'v22.0.0',
		print: (s) => (printed += s),
	});

	assert.strictEqual(code, 1, 'a corrupt index must not exit 0');
	assert.doesNotMatch(printed, /All checks passed/);

	// The old version of this test asserted only `✖ Symbols`, which the broken
	// behaviour also produced — while FTS, kinds, attribution and dimensions
	// printed green zeros for a file that is not a database.
	const byTitle = (title) =>
		printed
			.split('\n')
			.filter((line) => /^[✔⚠✖] /.test(line))
			.find((line) => line.slice(2).trim().startsWith(title));

	for (const title of [
		'Symbols',
		'FTS index',
		'Symbol kinds',
		'Framework attribution',
		'Vector dimensions',
	]) {
		const row = byTitle(title);
		assert.ok(row, `missing row: ${title}`);
		assert.ok(row.startsWith('✖'), `${title} must be a failure, got: ${row}`);
		assert.ok(
			!/^✔/.test(row),
			`${title} must not be green for a corrupt index`,
		);
	}
	assert.match(printed, /unreadable or corrupt/);
	assert.doesNotMatch(
		printed,
		/database opened but is empty/,
		'an unreadable file must not be reported as an empty database',
	);
});

test('--help prints usage on stdout and exits 0 without a report', async () => {
	let out = '';
	let err = '';
	const code = await runDoctorCli({
		argv: ['--help'],
		dbPath: '/nonexistent/apple-docs.db',
		provider: unavailable,
		nodeVersion: 'v22.0.0',
		print: (s) => (out += s),
		eprint: (s) => (err += s),
	});

	assert.strictEqual(code, 0);
	assert.match(out, /Usage:/);
	assert.match(out, /--json/);
	assert.match(out, /--strict/);
	assert.doesNotMatch(out, /Index file/, 'help must not run the checks');
	assert.strictEqual(err, '');
});

test('an unknown flag exits 2 with usage on stderr and no report', async () => {
	for (const flag of ['--jsn', '--stirct', '--nope']) {
		let out = '';
		let err = '';
		const code = await runDoctorCli({
			argv: [flag],
			dbPath: '/nonexistent/apple-docs.db',
			provider: unavailable,
			nodeVersion: 'v22.0.0',
			print: (s) => (out += s),
			eprint: (s) => (err += s),
		});

		assert.strictEqual(code, 2, `${flag} must be rejected, not ignored`);
		assert.match(err, /Usage:/, `${flag} must print usage on stderr`);
		assert.match(err, new RegExp(flag.slice(2)), `stderr must name ${flag}`);
		assert.strictEqual(out, '', `${flag} must not print a report on stdout`);
	}
});

test('--json still exits 1 on failure and stays parseable', async () => {
	let printed = '';
	const code = await runDoctorCli({
		argv: ['--json'],
		dbPath: '/nonexistent/apple-docs.db',
		provider: unavailable,
		nodeVersion: 'v22.0.0',
		print: (s) => (printed += s),
	});

	assert.strictEqual(code, 1);
	const parsed = JSON.parse(printed);
	assert.strictEqual(parsed.ok, false);
	assert.ok(parsed.failures > 0);
	assert.strictEqual(
		parsed.checks.find((c) => c.id === 'database_file').status,
		'fail',
	);
});

test('--strict turns warnings into a non-zero exit', async () => {
	const code = await runDoctorCli({
		argv: ['--strict'],
		dbPath: tmpDb(),
		provider: unavailable, // guarantees at least a provider warning
		nodeVersion: 'v22.0.0',
		print: () => {},
	});
	assert.strictEqual(code, 1);
});
