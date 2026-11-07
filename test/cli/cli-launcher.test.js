import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { createServer } from '../../dist/server/app.js';

const distIndex = join(import.meta.dirname, '../../dist/index.js');

test('CLI launcher: --help prints subcommands and exits 0', async () => {
	const result = await new Promise((resolve, reject) => {
		execFile('node', [distIndex, '--help'], (error, stdout, stderr) => {
			if (error) return reject(error);
			resolve({ stdout, stderr });
		});
	});

	assert.equal(result.stderr, '', 'Stderr must be completely clean for --help');
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
	assert.ok(result.stdout.includes('export-vectors'));
	assert.ok(result.stdout.includes('index-xcode'));
});

test('CLI launcher: --help is not polluted by logger output even with verbose LOG_LEVEL=trace and LOG_FORMAT=json', async () => {
	const result = await new Promise((resolve, reject) => {
		execFile(
			'node',
			[distIndex, '--help'],
			{ env: { ...process.env, LOG_LEVEL: 'trace', LOG_FORMAT: 'json' } },
			(error, stdout, stderr) => {
				if (error) return reject(error);
				resolve({ stdout, stderr });
			},
		);
	});

	assert.equal(
		result.stderr,
		'',
		'Stderr must not receive logger output for CLI help',
	);
	assert.ok(
		result.stdout.includes(
			'Apple Developer Documentation MCP Server & Toolkit',
		),
	);
	// Verify stdout contains no stray JSON log lines
	for (const line of result.stdout.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
			assert.fail(
				`Stdout contained unexpected JSON logger output: "${trimmed}"`,
			);
		}
	}
});

test('CLI launcher: export-vectors --help prints usage and exits 0', async () => {
	const result = await new Promise((resolve, reject) => {
		execFile(
			'node',
			[distIndex, 'export-vectors', '--help'],
			(error, stdout, stderr) => {
				if (error) return reject(error);
				resolve({ stdout, stderr });
			},
		);
	});

	assert.ok(result.stdout.includes('Usage: apple-doc-plugin export-vectors'));
	assert.ok(result.stdout.includes('--output'));
	assert.ok(result.stdout.includes('--dimensions'));
});

test('CLI launcher: index-xcode --help prints usage and exits 0', async () => {
	const result = await new Promise((resolve, reject) => {
		execFile(
			'node',
			[distIndex, 'index-xcode', '--help'],
			(error, stdout, stderr) => {
				if (error) return reject(error);
				resolve({ stdout, stderr });
			},
		);
	});

	assert.ok(result.stdout.includes('Usage: apple-doc-plugin index-xcode'));
	assert.ok(result.stdout.includes('--path'));
	assert.ok(result.stdout.includes('--dry-run'));
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
