import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../../dist/server/logger/index.js';
import {
	attachMcpLogging,
	mapToMcpLogLevel,
} from '../../dist/server/logger/mcp-transport.js';
import { LogLevel } from '../../dist/server/logger/level.js';

test('attachMcpLogging: maps internal levels to MCP specification and handles errors safely', () => {
	const dispatched = [];
	const mockMcpServer = {
		sendLoggingMessage: async (params) => {
			dispatched.push(params);
		},
	};

	const testLogger = createLogger({
		level: LogLevel.DEBUG,
		destination: () => {},
	});
	const detach = attachMcpLogging(testLogger, mockMcpServer);

	// Test mapping of WARN -> 'warning'
	testLogger.warn('Warning dispatched to client');
	assert.equal(dispatched.length, 1);
	assert.equal(
		dispatched[0].level,
		'warning',
		'Internal warn must be mapped to MCP warning',
	);

	detach();
});

test('attachMcpLogging: correctly maps all internal LogLevels to MCP protocol levels', () => {
	const dispatched = [];
	const mockMcpServer = {
		sendLoggingMessage: async (params) => {
			dispatched.push(params);
		},
	};

	const testLogger = createLogger({
		level: LogLevel.TRACE,
		destination: () => {},
	});
	const detach = attachMcpLogging(testLogger, mockMcpServer);

	testLogger.trace('trace event');
	testLogger.debug('debug event');
	testLogger.info('info event');
	testLogger.warn('warn event');
	testLogger.error('error event');

	assert.equal(dispatched.length, 5);
	assert.equal(dispatched[0].level, 'debug');
	assert.equal(dispatched[1].level, 'debug');
	assert.equal(dispatched[2].level, 'info');
	assert.equal(dispatched[3].level, 'warning');
	assert.equal(dispatched[4].level, 'error');

	// Verify logger property defaults to apple-doc-plugin
	assert.equal(dispatched[2].logger, 'apple-doc-plugin');

	detach();
});

test('attachMcpLogging: propagates child module name to logger parameter', () => {
	const dispatched = [];
	const mockMcpServer = {
		sendLoggingMessage: async (params) => {
			dispatched.push(params);
		},
	};

	const testLogger = createLogger({
		level: LogLevel.INFO,
		destination: () => {},
	});
	const detach = attachMcpLogging(testLogger, mockMcpServer);

	const childLogger = testLogger.child({ module: 'test-subsystem' });
	childLogger.info('Module specific log');

	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0].logger, 'test-subsystem');
	assert.equal(dispatched[0].data, 'Module specific log');

	detach();
});

test('attachMcpLogging: anti-reentrancy guard prevents infinite recursion when sendLoggingMessage logs', () => {
	let dispatchCount = 0;
	let innerLogged = false;

	let testLoggerRef;
	const mockMcpServer = {
		sendLoggingMessage: async () => {
			dispatchCount++;
			// Trigger re-entrant log inside the server transport
			if (testLoggerRef && !innerLogged) {
				innerLogged = true;
				testLoggerRef.error('Re-entrant log from within sendLoggingMessage');
			}
		},
	};

	const testLogger = createLogger({
		level: LogLevel.DEBUG,
		destination: () => {},
	});
	testLoggerRef = testLogger;
	const detach = attachMcpLogging(testLogger, mockMcpServer);

	testLogger.info('Initial message');

	// Anti-reentrancy should prevent inner log from re-dispatching
	assert.equal(dispatchCount, 1);
	assert.equal(innerLogged, true);

	detach();
});

test('attachMcpLogging: resilient against rejected promises in sendLoggingMessage', async () => {
	let attempts = 0;
	const mockMcpServer = {
		sendLoggingMessage: async () => {
			attempts++;
			if (attempts === 1) {
				throw new Error('Transport write failure');
			}
		},
	};

	const testLogger = createLogger({
		level: LogLevel.DEBUG,
		destination: () => {},
	});
	const detach = attachMcpLogging(testLogger, mockMcpServer);

	// First call throws in mock
	assert.doesNotThrow(() => {
		testLogger.info('First message that fails in transport');
	});

	// Wait for promise tick
	await new Promise((resolve) => setTimeout(resolve, 10));

	// Second call should succeed because re-entrancy lock was released in finally
	assert.doesNotThrow(() => {
		testLogger.info('Second message that should succeed');
	});

	assert.equal(attempts, 2);
	detach();
});

test('attachMcpLogging: unsubscription stops message delivery', () => {
	const dispatched = [];
	const mockMcpServer = {
		sendLoggingMessage: async (params) => {
			dispatched.push(params);
		},
	};

	const testLogger = createLogger({
		level: LogLevel.INFO,
		destination: () => {},
	});
	const detach = attachMcpLogging(testLogger, mockMcpServer);

	testLogger.info('Before detach');
	assert.equal(dispatched.length, 1);

	detach();
	testLogger.info('After detach');
	assert.equal(dispatched.length, 1);
});

test('Logger: child loggers inherit dynamic level changes from setLevel', () => {
	const output = [];
	const parent = createLogger({
		level: LogLevel.INFO,
		destination: (msg) => output.push(msg),
	});

	const child = parent.child({ module: 'child-subsystem' });

	// Initially INFO: debug is disabled for both
	assert.equal(parent.isLevelEnabled('debug'), false);
	assert.equal(child.isLevelEnabled('debug'), false);

	// Dynamically lower level to DEBUG
	parent.setLevel(LogLevel.DEBUG);
	assert.equal(parent.getLevel(), LogLevel.DEBUG);
	assert.equal(child.getLevel(), LogLevel.DEBUG);
	assert.equal(child.isLevelEnabled('debug'), true);

	child.debug('Child debug message');
	assert.equal(output.length, 1);
});

test('attachMcpLogging: includes error stack or message in data payload when entry has error', () => {
	const dispatched = [];
	const mockMcpServer = {
		sendLoggingMessage: async (params) => {
			dispatched.push(params);
		},
	};

	const testLogger = createLogger({
		level: LogLevel.DEBUG,
		destination: () => {},
	});
	const detach = attachMcpLogging(testLogger, mockMcpServer);

	const sampleErr = new Error('Database connection timeout');
	testLogger.error('Operation failed', sampleErr);

	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0].level, 'error');
	assert.match(dispatched[0].data, /Operation failed/);
	assert.match(dispatched[0].data, /Database connection timeout/);

	// Plain object error
	testLogger.error('Object error', { message: 'Network failed', code: 500 });
	assert.equal(dispatched.length, 2);
	assert.match(dispatched[1].data, /Object error/);
	assert.match(dispatched[1].data, /Network failed/);

	detach();
});

test('attachMcpLogging: registers SetLevelRequestSchema on server and dynamically updates logger level', async () => {
	const registeredHandlers = new Map();
	const mockMcpServer = {
		sendLoggingMessage: async () => {},
		setRequestHandler: (schema, handler) => {
			registeredHandlers.set(schema, handler);
		},
	};

	const testLogger = createLogger({
		level: LogLevel.INFO,
		destination: () => {},
	});
	const detach = attachMcpLogging(testLogger, mockMcpServer);

	assert.equal(registeredHandlers.has(SetLevelRequestSchema), true);
	assert.equal(testLogger.getLevel(), LogLevel.INFO);

	// Simulate client invoking setLevel to 'debug'
	const handler = registeredHandlers.get(SetLevelRequestSchema);
	const res = await handler({ params: { level: 'debug' } });
	assert.deepEqual(res, {});
	assert.equal(testLogger.getLevel(), LogLevel.DEBUG);

	// Simulate client invoking setLevel to 'error'
	await handler({ params: { level: 'error' } });
	assert.equal(testLogger.getLevel(), LogLevel.ERROR);

	detach();
});
