import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const binPath = join(__dirname, '../../dist/index.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll a predicate until it returns something truthy, or fail at the deadline.
 *
 * These tests spawn a real Node subprocess. A fixed `setTimeout` asks that
 * child to answer inside whatever budget is left after the rest of the suite
 * has loaded the machine, which is exactly how the assertions below failed
 * intermittently under parallel load while always passing in isolation.
 * Waiting for the actual condition removes the race without weakening any
 * assertion: if the child never answers, the failure says so.
 */
async function waitFor(
	label,
	predicate,
	{ timeoutMs = 15_000, intervalMs = 50 } = {},
) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = predicate();
		if (value) return value;
		if (Date.now() >= deadline) {
			throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
		}
		await sleep(intervalMs);
	}
}

/** Parse a stdout line, returning the decoded JSON-RPC frame or undefined. */
const parseJsonRpcFrame = (line) => {
	try {
		const parsed = JSON.parse(line);
		return parsed && parsed.jsonrpc === '2.0' ? parsed : undefined;
	} catch {
		return undefined;
	}
};

const stdoutFrames = (stdoutData) =>
	stdoutData
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => ({ line, parsed: parseJsonRpcFrame(line) }));

const initializeRequest = () =>
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

const spawnServer = (logFormat) => {
	const proc = spawn('node', [binPath], {
		env: { ...process.env, LOG_LEVEL: 'trace', LOG_FORMAT: logFormat },
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
	return {
		proc,
		getStdout: () => stdoutData,
		getStderr: () => stderrData,
	};
};

test('MCP stdio protocol isolation: stdout receives only valid JSON-RPC frames while logs go to stderr (JSON format)', async () => {
	const { proc, getStdout, getStderr } = spawnServer('json');

	try {
		proc.stdin.write(initializeRequest());

		await waitFor('the initialize response on stdout', () =>
			stdoutFrames(getStdout()).find(({ parsed }) => parsed?.id === 1),
		);

		// Assert stdout is valid JSON-RPC only
		const frames = stdoutFrames(getStdout());
		assert.ok(
			frames.length > 0,
			'Stdout should receive at least one JSON-RPC frame',
		);
		for (const { line, parsed } of frames) {
			assert.ok(parsed, `Stdout line must be valid JSON: "${line}"`);
		}

		// Assert stderr received structured logs
		await waitFor('structured startup logs on stderr', () =>
			getStderr().length > 0 ? getStderr() : undefined,
		);
		assert.match(getStderr(), /apple-doc-plugin|MCP server/);
	} finally {
		proc.kill('SIGTERM');
	}
});

test('MCP stdio protocol isolation: stdout receives only valid JSON-RPC frames while logs go to stderr (Text format)', async () => {
	const { proc, getStdout, getStderr } = spawnServer('text');

	try {
		proc.stdin.write(initializeRequest());

		await waitFor('the initialize response on stdout', () =>
			stdoutFrames(getStdout()).find(({ parsed }) => parsed?.id === 1),
		);

		// Assert stdout is valid JSON-RPC only
		const frames = stdoutFrames(getStdout());
		assert.ok(
			frames.length > 0,
			'Stdout should receive at least one JSON-RPC frame',
		);
		for (const { line, parsed } of frames) {
			assert.ok(parsed, `Stdout line must be valid JSON: "${line}"`);
		}

		// Assert stderr received text logs
		await waitFor('text startup logs on stderr', () =>
			getStderr().length > 0 ? getStderr() : undefined,
		);
		assert.match(getStderr(), /apple-doc-plugin|MCP server/);
	} finally {
		proc.kill('SIGTERM');
	}
});

test('MCP stdio protocol isolation: interactive flow (initialize -> tools/list) maintains pristine stdout wire format', async () => {
	const { proc, getStdout, getStderr } = spawnServer('text');

	try {
		// Step 1: Initialize
		proc.stdin.write(initializeRequest());

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

		await waitFor('both the initialize and tools/list responses', () => {
			const frames = stdoutFrames(getStdout());
			const initialize = frames.find(({ parsed }) => parsed?.id === 1);
			const toolsList = frames.find(
				({ parsed }) => parsed?.id === 2 && parsed.result?.tools,
			);
			return initialize && toolsList ? { initialize, toolsList } : undefined;
		});

		const frames = stdoutFrames(getStdout());
		assert.ok(
			frames.length >= 2,
			'Should receive responses for initialize and tools/list',
		);

		let foundToolsList = false;
		for (const { line, parsed } of frames) {
			assert.ok(parsed, `Stdout line must be valid JSON: "${line}"`);
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
		await waitFor('startup logs on stderr', () =>
			getStderr().length > 0 ? getStderr() : undefined,
		);
	} finally {
		proc.kill('SIGTERM');
	}
});
