import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	cleanJsonComments,
	installMcpServer,
	resolveTargetConfigPath,
} from '../../dist/server/services/installer.js';
import { runInstallerCli } from '../../dist/cli/commands/install.js';

test('cleanJsonComments: strips single-line, multi-line comments, and trailing commas', () => {
	const jsonWithComments = `
  {
    // Single line comment
    "name": "test",
    /* Multi-line
       comment */
    "items": [
      1,
      2,
    ],
  }
  `;
	const cleaned = cleanJsonComments(jsonWithComments);
	const parsed = JSON.parse(cleaned);
	assert.strictEqual(parsed.name, 'test');
	assert.deepStrictEqual(parsed.items, [1, 2]);
});

test('cleanJsonComments: preserves URLs and comments inside strings without corruption', () => {
	const jsonWithUrls = `
  {
    // Server endpoint
    "url": "https://api.example.com/mcp//v1",
    "git": "git://github.com/org/repo.git",
    "note": "/* not a comment */ inside string",
    "trailing": [
      "//not comment",
      "https://another.url",
      123,
    ],
  }
  `;
	const cleaned = cleanJsonComments(jsonWithUrls);
	const parsed = JSON.parse(cleaned);
	assert.strictEqual(parsed.url, 'https://api.example.com/mcp//v1');
	assert.strictEqual(parsed.git, 'git://github.com/org/repo.git');
	assert.strictEqual(parsed.note, '/* not a comment */ inside string');
	assert.strictEqual(parsed.trailing[0], '//not comment');
	assert.strictEqual(parsed.trailing[1], 'https://another.url');
	assert.strictEqual(parsed.trailing[2], 123);
});

test('resolveTargetConfigPath: correctly resolves across platforms', () => {
	const fakeHome = '/fake/home/user';
	const fakeAppData = 'C:\\fake\\AppData';

	// macOS
	assert.strictEqual(
		resolveTargetConfigPath('claude-desktop', {
			homeDir: fakeHome,
			platform: 'darwin',
		}),
		'/fake/home/user/Library/Application Support/Claude/claude_desktop_config.json',
	);

	// Windows
	assert.strictEqual(
		resolveTargetConfigPath('claude-desktop', {
			appData: fakeAppData,
			platform: 'win32',
		}),
		path.win32.join(fakeAppData, 'Claude', 'claude_desktop_config.json'),
	);

	// Windsurf
	assert.strictEqual(
		resolveTargetConfigPath('windsurf', {
			homeDir: fakeHome,
			platform: 'darwin',
		}),
		'/fake/home/user/.codeium/windsurf/mcp_config.json',
	);

	// Antigravity
	assert.strictEqual(
		resolveTargetConfigPath('antigravity', {
			homeDir: fakeHome,
			platform: 'darwin',
		}),
		'/fake/home/user/.gemini/antigravity/mcp_config.json',
	);

	// VSCode macOS
	assert.strictEqual(
		resolveTargetConfigPath('vscode', {
			homeDir: fakeHome,
			platform: 'darwin',
		}),
		'/fake/home/user/Library/Application Support/Code/User/mcp.json',
	);

	// VSCode Windows
	assert.strictEqual(
		resolveTargetConfigPath('vscode', {
			appData: fakeAppData,
			platform: 'win32',
		}),
		path.win32.join(fakeAppData, 'Code', 'User', 'mcp.json'),
	);

	// Unsupported target throws
	assert.throws(() => {
		resolveTargetConfigPath('unsupported-ide');
	}, /Unsupported target/);
});

test('installMcpServer: creates new config file when none exists', () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-install-'));
	const targetConfig = path.join(tempDir, 'mcp.json');

	const result = installMcpServer({
		target: 'cursor',
		configPath: targetConfig,
	});

	assert.strictEqual(result.createdNew, true);
	assert.strictEqual(result.updatedExisting, false);
	assert.strictEqual(result.serverName, 'apple-docs');
	assert.ok(fs.existsSync(targetConfig));

	const saved = JSON.parse(fs.readFileSync(targetConfig, 'utf8'));
	assert.ok(saved.mcpServers);
	assert.ok(saved.mcpServers['apple-docs']);
	assert.strictEqual(saved.mcpServers['apple-docs'].command, 'node');
	assert.ok(saved.mcpServers['apple-docs'].args[0].includes('launcher.cjs'));
});

test('installMcpServer: merges into existing config without overwriting peer servers', () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-install-'));
	const targetConfig = path.join(tempDir, 'mcp_config.json');

	const initial = {
		mcpServers: {
			'peer-server': {
				command: 'npx',
				args: ['peer-tool'],
			},
		},
	};
	fs.writeFileSync(targetConfig, JSON.stringify(initial, null, 2));

	const result = installMcpServer({
		target: 'windsurf',
		configPath: targetConfig,
	});

	assert.strictEqual(result.createdNew, false);
	assert.strictEqual(result.updatedExisting, false);

	const updated = JSON.parse(fs.readFileSync(targetConfig, 'utf8'));
	assert.ok(updated.mcpServers['peer-server'], 'Must preserve peer server');
	assert.ok(updated.mcpServers['apple-docs'], 'Must add apple-docs server');
});

test('installMcpServer: dryRun mode does not modify disk and returns preview', () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-install-'));
	const targetConfig = path.join(tempDir, 'non-existent', 'mcp.json');

	const result = installMcpServer({
		target: 'cursor',
		configPath: targetConfig,
		dryRun: true,
	});

	assert.strictEqual(result.dryRun, true);
	assert.strictEqual(fs.existsSync(targetConfig), false);
	assert.ok(result.configJson.includes('apple-docs'));
});

test('runInstallerCli: --help prints usage and exits 0', async () => {
	let output = '';
	const code = await runInstallerCli({
		argv: ['--help'],
		print: (t) => (output += t),
	});

	assert.strictEqual(code, 0);
	assert.ok(output.includes('Usage: apple-doc-plugin install'));
	assert.ok(output.includes('--target'));
	assert.ok(output.includes('--dry-run'));
});

test('runInstallerCli: missing --target prints error and exits 2', async () => {
	let errOutput = '';
	const code = await runInstallerCli({
		argv: [],
		print: () => {},
		eprint: (t) => (errOutput += t),
	});

	assert.strictEqual(code, 2);
	assert.ok(errOutput.includes('Missing required option "--target <target>"'));
});

test('runInstallerCli: --json prints parseable JSON and exits 0', async () => {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'apple-docs-cli-inst-'),
	);
	const targetConfig = path.join(tempDir, 'config.json');

	let output = '';
	const code = await runInstallerCli({
		argv: ['--target', 'cursor', '--config-path', targetConfig, '--json'],
		print: (t) => (output += t),
	});

	assert.strictEqual(code, 0);
	const parsed = JSON.parse(output);
	assert.strictEqual(parsed.ok, true);
	assert.strictEqual(parsed.target, 'cursor');
	assert.strictEqual(parsed.serverName, 'apple-docs');
});

test('runInstallerCli: --env flags configure server environment variables', async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-cli-env-'));
	const targetConfig = path.join(tempDir, 'config.json');

	const code = await runInstallerCli({
		argv: [
			'--target',
			'cursor',
			'--config-path',
			targetConfig,
			'--env',
			'GEMINI_API_KEY=test_api_key_123',
			'--env',
			'APPLE_DOCS_DB_PATH=/custom/db.db',
		],
		print: () => {},
	});

	assert.strictEqual(code, 0);
	const saved = JSON.parse(fs.readFileSync(targetConfig, 'utf8'));
	assert.ok(saved.mcpServers['apple-docs'].env);
	assert.strictEqual(
		saved.mcpServers['apple-docs'].env.GEMINI_API_KEY,
		'test_api_key_123',
	);
	assert.strictEqual(
		saved.mcpServers['apple-docs'].env.APPLE_DOCS_DB_PATH,
		'/custom/db.db',
	);
});
