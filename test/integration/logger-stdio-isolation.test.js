import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const binPath = join(__dirname, '../../dist/index.js');

test('MCP stdio protocol isolation: stdout receives only valid JSON-RPC frames while logs go to stderr (JSON format)', async () => {
	const proc = spawn('node', [binPath], {
		env: { ...process.env, LOG_LEVEL: 'trace', LOG_FORMAT: 'json' },
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	let stdoutData = '';
	let stderrData = '';

	proc.stdout.on('data', (d) => {
		stdoutData += d.toString();
	});
	proc.stderr.on('data', (d) => {
		stderrData += d.toString();
	});

	// Send MCP initialize request
	const initReq =
		JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: 'test-client', version: '1.0.0' },
			},
		}) + '\n';

	proc.stdin.write(initReq);

	await new Promise((resolve) => setTimeout(resolve, 800));
	proc.kill('SIGTERM');

	// Assert stdout is valid JSON-RPC only
	const stdoutLines = stdoutData.trim().split('\n').filter(Boolean);
	assert.ok(
		stdoutLines.length > 0,
		'Stdout should receive at least one JSON-RPC frame',
	);
	for (const line of stdoutLines) {
		assert.doesNotThrow(
			() => JSON.parse(line),
			`Stdout line must be valid JSON: "${line}"`,
		);
		const parsed = JSON.parse(line);
		assert.equal(parsed.jsonrpc, '2.0');
	}

	// Assert stderr received structured logs
	assert.ok(stderrData.length > 0, 'Stderr should contain startup log output');
	assert.match(stderrData, /apple-doc-plugin|MCP server/);
});

test('MCP stdio protocol isolation: stdout receives only valid JSON-RPC frames while logs go to stderr (Text format)', async () => {
	const proc = spawn('node', [binPath], {
		env: { ...process.env, LOG_LEVEL: 'trace', LOG_FORMAT: 'text' },
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	let stdoutData = '';
	let stderrData = '';

	proc.stdout.on('data', (d) => {
		stdoutData += d.toString();
	});
	proc.stderr.on('data', (d) => {
		stderrData += d.toString();
	});

	// Send MCP initialize request
	const initReq =
		JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: 'test-client', version: '1.0.0' },
			},
		}) + '\n';

	proc.stdin.write(initReq);

	await new Promise((resolve) => setTimeout(resolve, 800));
	proc.kill('SIGTERM');

	// Assert stdout is valid JSON-RPC only
	const stdoutLines = stdoutData.trim().split('\n').filter(Boolean);
	assert.ok(
		stdoutLines.length > 0,
		'Stdout should receive at least one JSON-RPC frame',
	);
	for (const line of stdoutLines) {
		assert.doesNotThrow(
			() => JSON.parse(line),
			`Stdout line must be valid JSON: "${line}"`,
		);
		const parsed = JSON.parse(line);
		assert.equal(parsed.jsonrpc, '2.0');
	}

	// Assert stderr received text logs
	assert.ok(stderrData.length > 0, 'Stderr should contain startup log output');
	assert.match(stderrData, /apple-doc-plugin|MCP server/);
});

test('MCP stdio protocol isolation: interactive flow (initialize -> tools/list) maintains pristine stdout wire format', async () => {
	const proc = spawn('node', [binPath], {
		env: { ...process.env, LOG_LEVEL: 'trace', LOG_FORMAT: 'text' },
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	let stdoutData = '';
	let stderrData = '';

	proc.stdout.on('data', (d) => {
		stdoutData += d.toString();
	});
	proc.stderr.on('data', (d) => {
		stderrData += d.toString();
	});

	// Step 1: Initialize
	proc.stdin.write(
		JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: 'test-client', version: '1.0.0' },
			},
		}) + '\n',
	);

	await new Promise((resolve) => setTimeout(resolve, 300));

	// Step 2: Initialized notification + list tools
	proc.stdin.write(
		JSON.stringify({
			jsonrpc: '2.0',
			method: 'notifications/initialized',
		}) + '\n',
	);

	proc.stdin.write(
		JSON.stringify({
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/list',
			params: {},
		}) + '\n',
	);

	await new Promise((resolve) => setTimeout(resolve, 500));
	proc.kill('SIGTERM');

	const stdoutLines = stdoutData.trim().split('\n').filter(Boolean);
	assert.ok(
		stdoutLines.length >= 2,
		'Should receive responses for initialize and tools/list',
	);

	let foundToolsList = false;
	for (const line of stdoutLines) {
		assert.doesNotThrow(
			() => JSON.parse(line),
			`Stdout line must be valid JSON: "${line}"`,
		);
		const parsed = JSON.parse(line);
		assert.equal(parsed.jsonrpc, '2.0');
		if (parsed.id === 2 && parsed.result?.tools) {
			foundToolsList = true;
			assert.ok(Array.isArray(parsed.result.tools));
			assert.ok(parsed.result.tools.length > 0);
		}
	}

	assert.ok(
		foundToolsList,
		'Should have received valid tools list response on stdout',
	);
	assert.ok(stderrData.length > 0, 'Stderr should have received logs');
});
