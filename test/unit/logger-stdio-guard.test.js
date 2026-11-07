import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, logger } from '../../dist/server/logger/index.js';
import { installStdioGuard } from '../../dist/server/logger/stdio-guard.js';

test('installStdioGuard: intercepts console.log and routes to stderr without corrupting stdout', () => {
	const intercepted = [];
	const testLogger = createLogger({
		destination: (msg) => intercepted.push(msg),
	});

	const uninstall = installStdioGuard(testLogger);
	try {
		console.log('Stray library log statement');
		assert.equal(intercepted.length, 1);
		assert.match(intercepted[0], /Stray library log statement/);
	} finally {
		uninstall();
	}
});

test('installStdioGuard: intercepts console.info and formats multiple arguments', () => {
	const intercepted = [];
	const testLogger = createLogger({
		destination: (msg) => intercepted.push(msg),
	});

	const uninstall = installStdioGuard(testLogger);
	try {
		console.info('Count: %d, Item: %s', 42, 'apple');
		assert.equal(intercepted.length, 1);
		assert.match(intercepted[0], /Count: 42, Item: apple/);
	} finally {
		uninstall();
	}
});

test('installStdioGuard: restores original console methods upon uninstall', () => {
	const originalLog = console.log;
	const originalInfo = console.info;

	const testLogger = createLogger({ destination: () => {} });
	const uninstall = installStdioGuard(testLogger);

	assert.notEqual(console.log, originalLog);
	assert.notEqual(console.info, originalInfo);

	uninstall();

	assert.equal(console.log, originalLog);
	assert.equal(console.info, originalInfo);

	// Calling uninstall again should be safe and idempotent
	assert.doesNotThrow(() => uninstall());
});

test('installStdioGuard: defaults to root logger when no logger parameter passed', () => {
	const originalLog = console.log;
	const uninstall = installStdioGuard();

	assert.notEqual(console.log, originalLog);
	uninstall();
	assert.equal(console.log, originalLog);
});
