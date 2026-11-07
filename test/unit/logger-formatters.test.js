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

test('formatters/index: re-exports formatTextEntry and formatJsonEntry', () => {
	assert.equal(typeof formatTextFromIndex, 'function');
	assert.equal(typeof formatJsonFromIndex, 'function');
});
