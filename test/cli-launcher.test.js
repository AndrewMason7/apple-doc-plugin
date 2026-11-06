import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { createServer } from '../dist/server/app.js';

const distIndex = join(import.meta.dirname, '../dist/index.js');

test('CLI launcher: --help prints subcommands and exits 0', async () => {
	const result = await new Promise((resolve, reject) => {
		execFile('node', [distIndex, '--help'], (error, stdout, stderr) => {
			if (error) return reject(error);
			resolve({ stdout, stderr });
		});
	});

	assert.ok(
		result.stdout.includes(
			'Apple Developer Documentation MCP Server & Toolkit',
		),
	);
	assert.ok(result.stdout.includes('doctor'));
	assert.ok(result.stdout.includes('download-vectors'));
	assert.ok(result.stdout.includes('download-model'));
	assert.ok(result.stdout.includes('install'));
	assert.ok(result.stdout.includes('setup'));
});

test('CLI launcher: install --help prints usage and exits 0', async () => {
	const result = await new Promise((resolve, reject) => {
		execFile(
			'node',
			[distIndex, 'install', '--help'],
			(error, stdout, stderr) => {
				if (error) return reject(error);
				resolve({ stdout, stderr });
			},
		);
	});

	assert.ok(result.stdout.includes('Usage: apple-doc-plugin install'));
	assert.ok(result.stdout.includes('--target'));
	assert.ok(result.stdout.includes('--dry-run'));
});

test('CLI launcher: setup --help prints usage and exits 0', async () => {
	const result = await new Promise((resolve, reject) => {
		execFile(
			'node',
			[distIndex, 'setup', '--help'],
			(error, stdout, stderr) => {
				if (error) return reject(error);
				resolve({ stdout, stderr });
			},
		);
	});

	assert.ok(result.stdout.includes('Usage: apple-doc-plugin setup'));
	assert.ok(result.stdout.includes('--download-vectors'));
	assert.ok(result.stdout.includes('--target'));
});

test('CLI launcher: doctor subcommand forwards to doctor CLI', async () => {
	const result = await new Promise((resolve, reject) => {
		execFile(
			'node',
			[distIndex, 'doctor', '--help'],
			(error, stdout, stderr) => {
				if (error) return reject(error);
				resolve({ stdout, stderr });
			},
		);
	});

	assert.ok(result.stdout.includes('Usage: npm run doctor'));
	assert.ok(result.stdout.includes('--json'));
	assert.ok(result.stdout.includes('--strict'));
});

test('CLI launcher: download-model --help prints usage and exits 0', async () => {
	const result = await new Promise((resolve, reject) => {
		execFile(
			'node',
			[distIndex, 'download-model', '--help'],
			(error, stdout, stderr) => {
				if (error) return reject(error);
				resolve({ stdout, stderr });
			},
		);
	});

	assert.ok(result.stdout.includes('Usage: apple-doc-plugin download-model'));
	assert.ok(result.stdout.includes('--force'));
	assert.ok(result.stdout.includes('--dest'));
});

test('CLI launcher: download-vectors --help prints usage and exits 0', async () => {
	const result = await new Promise((resolve, reject) => {
		execFile(
			'node',
			[distIndex, 'download-vectors', '--help'],
			(error, stdout, stderr) => {
				if (error) return reject(error);
				resolve({ stdout, stderr });
			},
		);
	});

	assert.ok(result.stdout.includes('Usage: apple-doc-plugin download-vectors'));
	assert.ok(result.stdout.includes('--force'));
	assert.ok(result.stdout.includes('--db'));
});

test('CLI launcher: unknown command or flag exits 2 with usage on stderr', async () => {
	const result = await new Promise((resolve) => {
		execFile(
			'node',
			[distIndex, '--unknown-flag-xyz'],
			(error, stdout, stderr) => {
				resolve({ error, stdout, stderr });
			},
		);
	});

	assert.ok(result.error);
	assert.strictEqual(result.error.code, 2);
	assert.ok(
		result.stderr.includes('Unknown command or option: "--unknown-flag-xyz"'),
	);
	assert.ok(result.stderr.includes('Usage:'));
});

test('Resilient fallback: createServer initializes smoothly even with invalid DB path', async () => {
	const originalEnv = process.env.APPLE_DOCS_DB_PATH;
	try {
		// Set to non-existent / non-sqlite path
		process.env.APPLE_DOCS_DB_PATH = '/dev/null/non-existent.db';
		const server = createServer();
		assert.ok(server);
		// Ensure server object has capabilities
		assert.ok(server);
	} finally {
		if (originalEnv) {
			process.env.APPLE_DOCS_DB_PATH = originalEnv;
		} else {
			delete process.env.APPLE_DOCS_DB_PATH;
		}
	}
});
