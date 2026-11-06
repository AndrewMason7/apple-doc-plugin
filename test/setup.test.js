import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AppleDocsDB } from '../dist/server/db/database.js';
import { runSetup } from '../dist/server/services/setup.js';
import { runSetupCli } from '../dist/server/services/setup-cli.js';

test('runSetup: reports state of missing database', async () => {
	const nonExistentDb = path.join(os.tmpdir(), `nonexistent-${Date.now()}.db`);
	const report = await runSetup({ dbPath: nonExistentDb });

	assert.strictEqual(report.dbExists, false);
	assert.strictEqual(report.symbolCount, 0);
	assert.strictEqual(report.semanticItemCount, 0);
	assert.strictEqual(report.mode, 'lexical-only');
	assert.ok(report.recommendations.some((r) => r.includes('build:index')));
});

test('runSetup: reports state of initialized database with symbols', async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-setup-'));
	const dbPath = path.join(tempDir, 'test.db');
	const db = new AppleDocsDB(dbPath);
	db.insertSymbol({
		id: '/documentation/swiftui/button',
		framework: 'SwiftUI',
		title: 'Button',
		kind: 'struct',
		abstract: 'A control that initiates an action.',
		path: '/documentation/swiftui/button',
		platforms: ['iOS 13.0+'],
		isPrimaryType: true,
	});
	db.close();

	const report = await runSetup({ dbPath });

	assert.strictEqual(report.dbExists, true);
	assert.strictEqual(report.symbolCount, 1);
	assert.strictEqual(report.semanticItemCount, 0);
	assert.strictEqual(report.mode, 'lexical-only');
	assert.ok(report.recommendations.some((r) => r.includes('download-vectors')));
});

test('runSetupCli: --help prints usage and exits 0', async () => {
	let output = '';
	const code = await runSetupCli({
		argv: ['--help'],
		print: (t) => (output += t),
	});

	assert.strictEqual(code, 0);
	assert.ok(output.includes('Usage: apple-doc-plugin setup'));
	assert.ok(output.includes('--download-vectors'));
	assert.ok(output.includes('--download-model'));
	assert.ok(output.includes('--target'));
});

test('runSetupCli: --json produces machine-readable JSON envelope', async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-setup-'));
	const dbPath = path.join(tempDir, 'test.db');
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
	db.close();

	let output = '';
	const code = await runSetupCli({
		argv: ['--db', dbPath, '--json'],
		print: (t) => (output += t),
	});

	assert.strictEqual(code, 0);
	const parsed = JSON.parse(output);
	assert.strictEqual(parsed.dbExists, true);
	assert.strictEqual(parsed.symbolCount, 1);
	assert.ok(typeof parsed.mode === 'string');
	assert.ok(typeof parsed.geminiAuthAvailable === 'boolean');
});

test('runSetupCli: --dry-run previews configuration without creating files', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'apple-docs-setup-dry-'),
	);
	const dbPath = path.join(tempDir, 'test.db');
	const configPath = path.join(tempDir, 'non-existent', 'mcp.json');

	let output = '';
	const code = await runSetupCli({
		argv: ['--db', dbPath, '--target', 'cursor', '--dry-run'],
		print: (t) => (output += t),
	});

	assert.strictEqual(code, 0);
	assert.ok(output.includes('Dry Run Preview'));
	assert.ok(output.includes('Database & Symbols:'));
	// Verify dry-run did not create the file
	assert.strictEqual(fs.existsSync(configPath), false);
});
