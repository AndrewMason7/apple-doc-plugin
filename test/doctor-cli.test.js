import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AppleDocsDB } from '../dist/server/db/database.js';
import { runDoctorCli } from '../dist/server/services/doctor-cli.js';

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
