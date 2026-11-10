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

test('installStdioGuard: intercepts console.warn and formats warning message', () => {
	const intercepted = [];
	const testLogger = createLogger({
		destination: (msg) => intercepted.push(msg),
	});

	const uninstall = installStdioGuard(testLogger);
	try {
		console.warn('Potential issue: %s', 'dimension mismatch');
		assert.equal(intercepted.length, 1);
		assert.match(intercepted[0], /Potential issue: dimension mismatch/);
		assert.match(intercepted[0], /WARN/);
	} finally {
		uninstall();
	}
});

test('installStdioGuard: restores original console methods upon uninstall', () => {
	const originalLog = console.log;
	const originalInfo = console.info;
	const originalWarn = console.warn;
	const originalDebug = console.debug;
	const originalDir = console.dir;

	const testLogger = createLogger({ destination: () => {} });
	const uninstall = installStdioGuard(testLogger);

	assert.notEqual(console.log, originalLog);
	assert.notEqual(console.info, originalInfo);
	assert.notEqual(console.warn, originalWarn);
	assert.notEqual(console.debug, originalDebug);
	assert.notEqual(console.dir, originalDir);

	uninstall();

	assert.equal(console.log, originalLog);
	assert.equal(console.info, originalInfo);
	assert.equal(console.warn, originalWarn);
	assert.equal(console.debug, originalDebug);
	assert.equal(console.dir, originalDir);

	// Calling uninstall again should be safe and idempotent
	assert.doesNotThrow(() => uninstall());
});

test('installStdioGuard: intercepts console.debug and routes to targetLogger.debug', () => {
	const intercepted = [];
	const testLogger = createLogger({
		level: 'debug',
		destination: (msg) => intercepted.push(msg),
	});

	const uninstall = installStdioGuard(testLogger);
	try {
		console.debug('Debug diagnostics payload: %d', 101);
		assert.equal(intercepted.length, 1);
		assert.match(intercepted[0], /Debug diagnostics payload: 101/);
		assert.match(intercepted[0], /\[DEBUG\]/);
	} finally {
		uninstall();
	}
});

test('installStdioGuard: intercepts console.dir and formats using inspect into targetLogger.info', () => {
	const intercepted = [];
	const testLogger = createLogger({
		destination: (msg) => intercepted.push(msg),
	});

	const uninstall = installStdioGuard(testLogger);
	try {
		console.dir({ framework: 'SwiftUI', symbols: 42 });
		assert.equal(intercepted.length, 1);
		assert.match(intercepted[0], /framework: 'SwiftUI'/);
		assert.match(intercepted[0], /symbols: 42/);
	} finally {
		uninstall();
	}
});

test('installStdioGuard: distinguishes between console.log() empty string and console.log(undefined)', () => {
	const intercepted = [];
	const testLogger = createLogger({
		destination: (msg) => intercepted.push(msg),
	});

	const uninstall = installStdioGuard(testLogger);
	try {
		console.log(undefined);
		assert.equal(intercepted.length, 1);
		assert.match(intercepted[0], /undefined/);

		console.log();
		assert.equal(intercepted.length, 2);
		// With empty args, it logs an empty message (just badge)
		assert.match(intercepted[1], /\[INFO\]\s*$/);
	} finally {
		uninstall();
	}
});

test('installStdioGuard: defaults to root logger when no logger parameter passed', () => {
	const originalLog = console.log;
	const uninstall = installStdioGuard();

	assert.notEqual(console.log, originalLog);
	uninstall();
	assert.equal(console.log, originalLog);
});
