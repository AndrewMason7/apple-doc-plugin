import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const projectRoot = join(import.meta.dirname, '..');

test('packaging: scripts/build-binary.sh exists and is executable', () => {
	const scriptPath = join(projectRoot, 'scripts/build-binary.sh');
	assert.ok(existsSync(scriptPath));
	const stat = statSync(scriptPath);
	// Check execute bits (user, group, or others)
	const isExecutable = (stat.mode & 0o111) !== 0;
	assert.strictEqual(isExecutable, true);
});

test('packaging: Homebrew formula apple-doc-plugin.rb is valid and well-formed', () => {
	const formulaPath = join(
		projectRoot,
		'packaging/homebrew/apple-doc-plugin.rb',
	);
	assert.ok(existsSync(formulaPath));
	const content = readFileSync(formulaPath, 'utf-8');

	assert.ok(content.includes('class AppleDocPlugin < Formula'));
	assert.ok(content.includes('desc "Apple Developer Documentation MCP Server'));
	assert.ok(
		content.includes(
			'homepage "https://github.com/AndrewMason7/apple-doc-plugin"',
		),
	);
	assert.ok(content.includes('depends_on "node"'));
	assert.ok(content.includes('def install'));
	assert.ok(content.includes('test do'));
	assert.ok(content.includes('apple-doc-plugin --help'));
});

test('packaging: bin/apple-doc-plugin-native executes and shows help', () => {
	const binPath = join(projectRoot, 'bin/apple-doc-plugin-native');
	if (!existsSync(binPath)) {
		// Build it if not yet present
		execFileSync(join(projectRoot, 'scripts/build-binary.sh'), {
			cwd: projectRoot,
			stdio: 'pipe',
		});
	}

	assert.ok(existsSync(binPath));
	const output = execFileSync('node', [binPath, '--help'], {
		encoding: 'utf-8',
	});
	assert.ok(
		output.includes('Apple Developer Documentation MCP Server & Toolkit'),
	);
	assert.ok(output.includes('export-vectors'));
	assert.ok(output.includes('index-xcode'));
});

test('packaging: scripts/build-binary.sh supports --tarball flag', () => {
	const scriptPath = join(projectRoot, 'scripts/build-binary.sh');
	const output = execFileSync(scriptPath, ['--help'], {
		cwd: projectRoot,
		encoding: 'utf-8',
	});
	assert.ok(output.includes('--tarball'));
});
