import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	createLogger,
	logger as singletonLogger,
	Logger,
} from '../../dist/server/logger/index.js';
import { LogRingBuffer } from '../../dist/server/logger/ring-buffer.js';
import { LogLevel } from '../../dist/server/logger/level.js';
import { logger as rootLogger } from '../../dist/server/logger.js';

test('Logger: early level check suppresses formatting overhead when level is disabled', () => {
	let formatted = false;
	const testLogger = createLogger({
		level: LogLevel.INFO,
		destination: () => {
			formatted = true;
		},
	});

	testLogger.debug('Debug message that should be skipped');
	assert.equal(formatted, false);
});

test('Logger: child logger inherits bindings and maintains scope isolation', () => {
	const output = [];
	const testLogger = createLogger({
		level: LogLevel.DEBUG,
		destination: (msg) => output.push(msg),
		format: 'json',
	});

	const childA = testLogger.child({ module: 'subsystem-a' });
	const childB = testLogger.child({ module: 'subsystem-b' });

	childA.info('Event A');
	childB.info('Event B');

	assert.equal(output.length, 2);
	const parsedA = JSON.parse(output[0]);
	const parsedB = JSON.parse(output[1]);
	assert.equal(parsedA.module, 'subsystem-a');
	assert.equal(parsedB.module, 'subsystem-b');

	// Verify nested child inherits from parent and grandparent
	const nestedChild = childA.child({ component: 'indexer' });
	nestedChild.info('Nested event');
	assert.equal(output.length, 3);
	const parsedNested = JSON.parse(output[2]);
	assert.equal(parsedNested.module, 'subsystem-a');
	assert.equal(parsedNested.component, 'indexer');

	// Verify childA was not mutated by nestedChild
	assert.equal(childA.getBindings().component, undefined);
});

test('LogRingBuffer: stores memory-safe snapshots and enforces FIFO bound', () => {
	const testLogger = createLogger({
		level: LogLevel.DEBUG,
		ringBufferSize: 2,
		destination: () => {},
	});

	testLogger.info('first');
	testLogger.info('second');
	testLogger.info('third');

	const recent = testLogger.getRingBuffer().getRecent();
	assert.equal(recent.length, 2);
	assert.equal(recent[0].message, 'second');
	assert.equal(recent[1].message, 'third');
});

test('LogRingBuffer: supports count slicing, clear, size, and formatDiagnostics', () => {
	const ring = new LogRingBuffer(3);
	assert.equal(ring.size(), 0);
	assert.equal(ring.formatDiagnostics(), '');

	ring.push({
		timestamp: '2026-11-07T12:00:00.000Z',
		level: 'info',
		module: 'test-mod',
		message: 'Msg 1',
	});
	ring.push({
		timestamp: '2026-11-07T12:00:01.000Z',
		level: 'warn',
		message: 'Msg 2',
	});
	ring.push({
		timestamp: '2026-11-07T12:00:02.000Z',
		level: 'error',
		module: 'test-mod',
		message: 'Msg 3',
		details: { code: 'FAIL' },
	});

	assert.equal(ring.size(), 3);
	const last1 = ring.getRecent(1);
	assert.equal(last1.length, 1);
	assert.equal(last1[0].message, 'Msg 3');

	const last2 = ring.getRecent(2);
	assert.equal(last2.length, 2);
	assert.equal(last2[0].message, 'Msg 2');
	assert.equal(last2[1].message, 'Msg 3');

	const diag = ring.formatDiagnostics();
	assert.match(
		diag,
		/\[2026-11-07T12:00:00.000Z\] \[INFO\] \[test-mod\] Msg 1/,
	);
	assert.match(diag, /\[2026-11-07T12:00:01.000Z\] \[WARN\] Msg 2/);
	assert.match(
		diag,
		/\[2026-11-07T12:00:02.000Z\] \[ERROR\] \[test-mod\] Msg 3/,
	);

	// Overwrite oldest item via FIFO eviction
	ring.push({
		timestamp: '2026-11-07T12:00:03.000Z',
		level: 'info',
		message: 'Msg 4',
	});
	assert.equal(ring.size(), 3);
	const recentAfterEviction = ring.getRecent();
	assert.equal(recentAfterEviction[0].message, 'Msg 2');
	assert.equal(recentAfterEviction[1].message, 'Msg 3');
	assert.equal(recentAfterEviction[2].message, 'Msg 4');

	ring.clear();
	assert.equal(ring.size(), 0);
	assert.equal(ring.getRecent().length, 0);
	assert.equal(ring.formatDiagnostics(), '');
});

test('Logger: captures Error in args and serializes it safely', () => {
	const output = [];
	const testLogger = createLogger({
		level: LogLevel.DEBUG,
		destination: (msg) => output.push(msg),
		format: 'json',
	});

	const err = new Error('Database connection failed');
	err.code = 'ECONNREFUSED';

	testLogger.error('Failed to connect to database', err);

	assert.equal(output.length, 1);
	const parsed = JSON.parse(output[0]);
	assert.equal(parsed.level, 'error');
	assert.equal(parsed.message, 'Failed to connect to database');
	assert.ok(parsed.error);
	assert.equal(parsed.error.name, 'Error');
	assert.equal(parsed.error.message, 'Database connection failed');
	assert.equal(parsed.error.code, 'ECONNREFUSED');
	assert.ok(parsed.error.stack);
});

test('Logger: redacts credentials in message and args by default', () => {
	const output = [];
	const testLogger = createLogger({
		level: LogLevel.DEBUG,
		destination: (msg) => output.push(msg),
		format: 'json',
		redact: true,
	});

	testLogger.info('Connecting with key AIzaSyFakeToken1234567890', {
		apiKey: 'super-secret-key-123',
		user: 'alice',
	});

	assert.equal(output.length, 1);
	const parsed = JSON.parse(output[0]);
	assert.ok(!parsed.message.includes('AIzaSyFakeToken1234567890'));
	assert.match(parsed.message, /\[REDACTED\]/);
	assert.ok(!output[0].includes('super-secret-key-123'));
});

test('Logger: subscriber hook receives entries and handles unsubscribe cleanly', () => {
	const testLogger = createLogger({
		level: LogLevel.DEBUG,
		destination: () => {},
	});

	const received = [];
	const unsubscribe = testLogger.subscribe((entry) => {
		received.push(entry);
	});

	testLogger.info('Hello subscriber');
	assert.equal(received.length, 1);
	assert.equal(received[0].message, 'Hello subscriber');
	assert.equal(received[0].level, LogLevel.INFO);

	// Child logger emits to the same subscriber
	const child = testLogger.child({ module: 'worker' });
	child.warn('Warning from child');
	assert.equal(received.length, 2);
	assert.equal(received[1].message, 'Warning from child');
	assert.equal(received[1].module, 'worker');

	unsubscribe();
	testLogger.info('Ignored by unsubscribed listener');
	assert.equal(received.length, 2);
});

test('Logger: setLevel, getLevel, and isLevelEnabled operate correctly', () => {
	const testLogger = createLogger({
		level: LogLevel.INFO,
		destination: () => {},
	});

	assert.equal(testLogger.getLevel(), LogLevel.INFO);
	assert.equal(testLogger.isLevelEnabled(LogLevel.DEBUG), false);
	assert.equal(testLogger.isLevelEnabled('debug'), false);
	assert.equal(testLogger.isLevelEnabled(LogLevel.INFO), true);
	assert.equal(testLogger.isLevelEnabled('warn'), true);

	testLogger.setLevel(LogLevel.DEBUG);
	assert.equal(testLogger.getLevel(), LogLevel.DEBUG);
	assert.equal(testLogger.isLevelEnabled('debug'), true);

	testLogger.setLevel('warn');
	assert.equal(testLogger.getLevel(), LogLevel.WARN);
	assert.equal(testLogger.isLevelEnabled('info'), false);
	assert.equal(testLogger.isLevelEnabled('warn'), true);
});

test('Logger: setFormat and getFormat dynamically updates format across logger and child loggers', () => {
	const output = [];
	const testLogger = createLogger({
		level: LogLevel.DEBUG,
		format: 'text',
		destination: (msg) => output.push(msg),
	});

	const child = testLogger.child({ module: 'format-test' });

	assert.equal(testLogger.getFormat(), 'text');
	assert.equal(child.getFormat(), 'text');

	testLogger.info('Message in text format');
	assert.equal(output.length, 1);
	assert.match(output[0], /\[INFO\] Message in text format/);

	// Change format to JSON dynamically
	testLogger.setFormat('json');
	assert.equal(testLogger.getFormat(), 'json');
	assert.equal(child.getFormat(), 'json');

	child.info('Message in json format');
	assert.equal(output.length, 2);
	assert.doesNotThrow(() => JSON.parse(output[1]));
	const parsed = JSON.parse(output[1]);
	assert.equal(parsed.message, 'Message in json format');
	assert.equal(parsed.module, 'format-test');

	// Switch back to text
	testLogger.setFormat('text');
	assert.equal(testLogger.getFormat(), 'text');
	child.info('Back to text format');
	assert.equal(output.length, 3);
	assert.match(output[2], /Back to text format/);
});

test('LogRingBuffer: ignores non-object or null snapshots safely', () => {
	const ring = new LogRingBuffer(5);
	// @ts-expect-error test non-object runtime inputs
	ring.push(null);
	// @ts-expect-error test non-object runtime inputs
	ring.push(undefined);
	// @ts-expect-error test non-object runtime inputs
	ring.push('not an object');
	// @ts-expect-error test non-object runtime inputs
	ring.push(42);

	assert.equal(ring.size(), 0);
	assert.equal(ring.getRecent().length, 0);

	ring.push({
		timestamp: '2026-11-07T12:00:00.000Z',
		level: 'info',
		message: 'Valid snapshot',
	});
	assert.equal(ring.size(), 1);
});

test('Logger: root singleton and backwards-compatible export from src/server/logger.ts', () => {
	assert.ok(singletonLogger instanceof Logger);
	assert.ok(rootLogger instanceof Logger);
	assert.strictEqual(singletonLogger, rootLogger);

	assert.doesNotThrow(() => {
		rootLogger.debug('backwards compatibility check');
		rootLogger.info('backwards compatibility check');
		rootLogger.warn('backwards compatibility check');
		rootLogger.error('backwards compatibility check');
	});
});
