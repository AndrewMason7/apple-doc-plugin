import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	LogLevel,
	parseLogLevel,
	LOG_LEVEL_NAMES,
} from '../../dist/server/logger/level.js';
import { formatTextEntry } from '../../dist/server/logger/formatters/text.js';
import { formatJsonEntry } from '../../dist/server/logger/formatters/json.js';
import {
	formatTextEntry as formatTextFromIndex,
	formatJsonEntry as formatJsonFromIndex,
} from '../../dist/server/logger/formatters/index.js';

test('parseLogLevel: parses level names case-insensitively and respects defaults', () => {
	assert.equal(parseLogLevel('debug'), LogLevel.DEBUG);
	assert.equal(parseLogLevel('WARN'), LogLevel.WARN);
	assert.equal(parseLogLevel('silent'), LogLevel.SILENT);
	assert.equal(parseLogLevel('unknown', LogLevel.INFO), LogLevel.INFO);
	assert.equal(parseLogLevel(undefined, LogLevel.INFO), LogLevel.INFO);
});

test('parseLogLevel: handles edge cases and aliases', () => {
	assert.equal(parseLogLevel(), LogLevel.INFO);
	assert.equal(parseLogLevel('  trace  '), LogLevel.TRACE);
	assert.equal(parseLogLevel('warning'), LogLevel.WARN);
	assert.equal(parseLogLevel('ERROR'), LogLevel.ERROR);
	assert.equal(parseLogLevel('invalid'), LogLevel.INFO);
	assert.equal(LOG_LEVEL_NAMES[LogLevel.DEBUG], 'debug');
	assert.equal(LOG_LEVEL_NAMES[LogLevel.WARN], 'warn');
});

test('parseLogLevel: supports numeric LogLevel enum values and guards non-string inputs', () => {
	assert.equal(parseLogLevel(LogLevel.DEBUG), LogLevel.DEBUG);
	assert.equal(parseLogLevel(LogLevel.WARN), LogLevel.WARN);
	assert.equal(parseLogLevel(LogLevel.ERROR), LogLevel.ERROR);
	assert.equal(parseLogLevel(LogLevel.TRACE), LogLevel.TRACE);
	assert.equal(parseLogLevel(LogLevel.SILENT), LogLevel.SILENT);
	assert.equal(parseLogLevel(LogLevel.INFO), LogLevel.INFO);
	// invalid numbers fall back to default
	assert.equal(parseLogLevel(999, LogLevel.WARN), LogLevel.WARN);
	assert.equal(parseLogLevel(999), LogLevel.INFO);
	// objects, booleans, functions fall back to default
	assert.equal(parseLogLevel({}, LogLevel.WARN), LogLevel.WARN);
	assert.equal(parseLogLevel(true, LogLevel.INFO), LogLevel.INFO);
});

test('formatJsonEntry: outputs valid single-line JSON containing standard fields', () => {
	const entry = {
		timestamp: new Date('2026-11-07T12:00:00.000Z'),
		level: LogLevel.INFO,
		levelName: 'info',
		message: 'Server started',
		bindings: { module: 'core' },
		args: [],
	};
	const jsonStr = formatJsonEntry(entry);
	const parsed = JSON.parse(jsonStr);
	assert.equal(parsed.level, 'info');
	assert.equal(parsed.message, 'Server started');
	assert.equal(parsed.module, 'core');
	assert.equal(parsed.timestamp, '2026-11-07T12:00:00.000Z');
	assert.ok(
		!jsonStr.includes('\n'),
		'JSON output must be single-line for log parsers',
	);
});

test('formatJsonEntry: protects standard envelope fields from being overwritten by bindings', () => {
	const entry = {
		timestamp: new Date('2026-11-07T12:00:00.000Z'),
		level: LogLevel.ERROR,
		levelName: 'error',
		message: 'Authentic message',
		bindings: {
			timestamp: '1970-01-01T00:00:00.000Z',
			level: 'debug',
			message: 'Clobbered message',
			customField: 'preserved',
		},
		args: [],
	};
	const jsonStr = formatJsonEntry(entry);
	const parsed = JSON.parse(jsonStr);
	assert.equal(parsed.timestamp, '2026-11-07T12:00:00.000Z');
	assert.equal(parsed.level, 'error');
	assert.equal(parsed.message, 'Authentic message');
	assert.equal(parsed.customField, 'preserved');
});

test('formatJsonEntry: formats args with util.format and handles circular objects safely', () => {
	const circular = { a: 1 };
	circular.self = circular;

	const entry = {
		timestamp: new Date('2026-11-07T12:00:00.000Z'),
		level: LogLevel.ERROR,
		levelName: 'error',
		message: 'Error code %d: %s',
		bindings: { module: 'network', context: circular },
		args: [500, 'Internal Server Error'],
	};
	const jsonStr = formatJsonEntry(entry);
	const parsed = JSON.parse(jsonStr);
	assert.equal(parsed.level, 'error');
	assert.equal(parsed.message, 'Error code 500: Internal Server Error');
	assert.equal(parsed.module, 'network');
	assert.equal(parsed.context.self, '[Circular]');
	assert.ok(!jsonStr.includes('\n'), 'Must remain single-line');
});

test('formatTextEntry: outputs readable text with timestamp badge and module tag', () => {
	const entry = {
		timestamp: new Date('2026-11-07T12:00:00.000Z'),
		level: LogLevel.WARN,
		levelName: 'warn',
		message: 'Disk threshold low',
		bindings: { module: 'storage' },
		args: [],
	};
	const text = formatTextEntry(entry);
	assert.match(text, /\[2026-11-07T12:00:00.000Z\]/);
	assert.match(text, /\[WARN\]/);
	assert.match(text, /\[storage\]/);
	assert.match(text, /Disk threshold low/);
});

test('formatTextEntry: formats entry without module tag and with args', () => {
	const entry = {
		timestamp: new Date('2026-11-07T12:00:00.000Z'),
		level: LogLevel.INFO,
		levelName: 'info',
		message: 'Listening on port %d',
		args: [3000],
	};
	const text = formatTextEntry(entry);
	assert.match(text, /\[2026-11-07T12:00:00.000Z\]/);
	assert.match(text, /\[INFO\]/);
	assert.match(text, /Listening on port 3000/);
	assert.ok(!text.includes('[undefined]'));
});

test('formatTextEntry: safely formats circular references and BigInts in extra bindings without throwing', () => {
	const circular = { id: 100n };
	circular.self = circular;

	const entry = {
		timestamp: new Date('2026-11-07T12:00:00.000Z'),
		level: LogLevel.INFO,
		levelName: 'info',
		message: 'Processing task',
		bindings: { module: 'worker', meta: circular, count: 42n },
		args: [],
	};

	assert.doesNotThrow(() => {
		const text = formatTextEntry(entry);
		assert.match(text, /\[worker\]/);
		assert.match(text, /Processing task/);
		assert.match(text, /"self":"\[Circular\]"/);
		assert.match(text, /"count":"42"/);
	});
});

test('formatters: safely handles invalid Date instances and appends error in text format', () => {
	const invalidDateEntry = {
		timestamp: new Date(NaN),
		level: LogLevel.WARN,
		levelName: 'warn',
		message: 'Something went wrong',
		error: new Error('Database connection failed'),
	};

	assert.doesNotThrow(() => {
		const text = formatTextEntry(invalidDateEntry);
		assert.match(text, /\[WARN\]/);
		assert.match(text, /Something went wrong/);
		assert.match(text, /Database connection failed/);
	});

	assert.doesNotThrow(() => {
		const json = formatJsonEntry(invalidDateEntry);
		const parsed = JSON.parse(json);
		assert.equal(parsed.level, 'warn');
		assert.equal(parsed.message, 'Something went wrong');
		assert.equal(parsed.error.message, 'Database connection failed');
		assert.ok(typeof parsed.timestamp === 'string');
	});
});

test('formatters/index: re-exports formatTextEntry and formatJsonEntry', () => {
	assert.equal(typeof formatTextFromIndex, 'function');
	assert.equal(typeof formatJsonFromIndex, 'function');
});

test('formatTextEntry: safeStringify falls back to [Unreadable] when serialization throws', () => {
	const evilObject = {};
	Object.defineProperty(evilObject, 'prop', {
		get() {
			throw new Error('Getter boom');
		},
		enumerable: true,
	});

	const entry = {
		timestamp: new Date('2026-11-07T12:00:00.000Z'),
		level: LogLevel.INFO,
		levelName: 'info',
		message: 'Test message',
		bindings: { evil: evilObject },
		args: [],
	};

	const text = formatTextEntry(entry);
	assert.match(text, /\[Unreadable\]/);
});
