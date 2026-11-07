# Production-Grade Logging System Implementation Plan (Hardened)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the primitive 16-line `console.error` wrapper into an enterprise-ready, zero-dependency logging engine with configurable severity levels, structured JSON formatting, bounded credential redaction, scoped child loggers, memory-safe diagnostic ring buffering, stdio stream protection, and MCP protocol notification integration.

**Architecture:** A modular, decoupled logging engine in `src/server/logger/` enforcing strict Separation of Concerns: early-gated log level filtering, bounded secret scrubbing, error cause chain normalization, memory-safe circular snapshot queue, stdout protocol wire protection, and an anti-reentrant, non-blocking MCP logging transport (`notifications/message`).

**Tech Stack:** Node.js 22+ ESM, TypeScript 5.9, `@modelcontextprotocol/sdk`, Node.js native standard modules (`node:util`, `node:events`).

**Spec:** `docs/superpowers/specs/2026-11-07-production-grade-logging-design.md`

## Global Constraints

- **Stdio Protocol Inviolability**: Standard output (`stdout`) must remain strictly reserved for JSON-RPC frames; all log text must write to `stderr`, and `console.log` must be intercepted and safely redirected to `stderr` in stdio server mode.
- **Zero Runtime Dependencies**: The logging engine must use only native Node.js APIs (`node:util`, `node:events`, `node:process`) without third-party logging packages.
- **Backwards Compatibility**: Existing `logger.debug()`, `logger.info()`, `logger.warn()`, and `logger.error()` calls across all modules must continue to work seamlessly without signature changes.
- **Synchronous Public API**: All public logger methods must remain synchronous to avoid floating promises or unhandled rejections across existing call sites.
- **Performance**: Inactive log calls must exit in under 5 nanoseconds via an early active-level check, avoiding string interpolation or object traversal overhead.
- **Memory Safety**: The diagnostic ring buffer must store bounded snapshots rather than raw argument object references to prevent memory leaks during long-running sessions.
- **Strict Verification**: Every task must have automated unit tests executed via `node --test` or `npm test`, with 100% clean passes.

## Review Focus

1. **Stdio Stream Pollution**: Ensure that even unexpected logger exceptions, stray `console.log` statements, or fatal errors write to `stderr`, never corrupting the client JSON-RPC stream on `stdout`.
2. **Secret Leaks in Metadata & Errors**: Verify that API keys (e.g. `GEMINI_API_KEY`, `AIzaSy...`), authorization bearer tokens, and credentials embedded inside error messages or objects are redacted before serialization.
3. **Circular Object References & Bounded Traversal**: Ensure custom metadata or error objects with circular references or massive depth/arrays do not cause stack overflows or event-loop stalls.
4. **Child Logger Scope Isolation**: Verify that bindings applied to child loggers (e.g. `{ module: 'search' }`) do not mutate the root logger's context or sibling child loggers.
5. **MCP Protocol Level Compliance & Anti-Reentrancy**: Verify that internal `warn` is mapped to MCP `'warning'`, and that internal errors during `server.sendLoggingMessage()` do not trigger an infinite recursive loop.

---

### Task 1: Core Types, Severity Levels, and Formatters

**Files:**

- Create: `src/server/logger/types.ts`
- Create: `src/server/logger/level.ts`
- Create: `src/server/logger/formatters/text.ts`
- Create: `src/server/logger/formatters/json.ts`
- Create: `src/server/logger/formatters/index.ts`
- Test: `test/unit/logger-formatters.test.js`

**Interfaces:**

- Consumes: None (base primitives)
- Produces:
  - `enum LogLevel { TRACE = 10, DEBUG = 20, INFO = 30, WARN = 40, ERROR = 50, SILENT = 60 }`
  - `parseLogLevel(name?: string, defaultLevel?: LogLevel): LogLevel`
  - `formatTextEntry(entry: LogEntry): string`
  - `formatJsonEntry(entry: LogEntry): string`

- [ ] **Step 1: Write the failing test**

```javascript
// test/unit/logger-formatters.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LogLevel, parseLogLevel } from '../../dist/server/logger/level.js';
import { formatTextEntry } from '../../dist/server/logger/formatters/text.js';
import { formatJsonEntry } from '../../dist/server/logger/formatters/json.js';

test('parseLogLevel: parses level names case-insensitively and respects defaults', () => {
	assert.equal(parseLogLevel('debug'), LogLevel.DEBUG);
	assert.equal(parseLogLevel('WARN'), LogLevel.WARN);
	assert.equal(parseLogLevel('silent'), LogLevel.SILENT);
	assert.equal(parseLogLevel('unknown', LogLevel.INFO), LogLevel.INFO);
	assert.equal(parseLogLevel(undefined, LogLevel.INFO), LogLevel.INFO);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/logger-formatters.test.js`  
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement `types.ts`, `level.ts`, and `formatters/`**

Implement `LogLevel` numeric enum, parsing logic from environment variables (`LOG_LEVEL`), and pure formatting functions for single-line JSON and readable text formatting with ISO timestamps.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/unit/logger-formatters.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/logger/types.ts src/server/logger/level.ts src/server/logger/formatters/ test/unit/logger-formatters.test.js
git commit -m "feat(logger): implement core log levels and text/json formatters"
```

---

### Task 2: Credential Redaction & Safe Error Normalization

**Files:**

- Create: `src/server/logger/redactor.ts`
- Create: `src/server/logger/error-serializer.ts`
- Test: `test/unit/logger-redactor.test.js`

**Interfaces:**

- Consumes: `types.ts`
- Produces:
  - `redactSensitiveText(text: string): string`
  - `redactSensitiveData<T>(obj: T, options?: RedactOptions): T`
  - `serializeError(err: unknown): SerializedError`

- [ ] **Step 1: Write the failing test**

```javascript
// test/unit/logger-redactor.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	redactSensitiveText,
	redactSensitiveData,
} from '../../dist/server/logger/redactor.js';
import { serializeError } from '../../dist/server/logger/error-serializer.js';

test('redactSensitiveText: masks API keys, bearer tokens, and private credentials', () => {
	const raw =
		'Request failed with key AIzaSyD1234567890abcdef and token Bearer eyJhbGciOiJIUzI1NiJ9';
	const sanitized = redactSensitiveText(raw);
	assert.doesNotMatch(sanitized, /AIzaSyD1234567890abcdef/);
	assert.doesNotMatch(sanitized, /eyJhbGciOiJIUzI1NiJ9/);
	assert.match(sanitized, /\[REDACTED\]/);
});

test('redactSensitiveData: handles circular references and limits depth safely', () => {
	const circular = { name: 'cycle' };
	circular.self = circular;

	const sanitized = redactSensitiveData(circular);
	assert.equal(sanitized.name, 'cycle');
	assert.equal(sanitized.self, '[Circular]');
});

test('serializeError: extracts name, message, stack, code, and cause chains safely', () => {
	const cause = new Error('Root network socket hangup');
	const top = new Error('Database connection failed', { cause });
	const serialized = serializeError(top);
	assert.equal(serialized.message, 'Database connection failed');
	assert.ok(serialized.stack);
	assert.equal(serialized.cause?.message, 'Root network socket hangup');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/logger-redactor.test.js`  
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement `redactor.ts` and `error-serializer.ts`**

Implement regex scrubbing for Google/Gemini keys, Bearer headers, sensitive JSON keys (`password`, `token`, `secret`, `apiKey`), bounded object walker (depth: 5, array length: 25) with `WeakSet` circular protection, and recursive error serializer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/unit/logger-redactor.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/logger/redactor.ts src/server/logger/error-serializer.ts test/unit/logger-redactor.test.js
git commit -m "feat(logger): implement bounded credential redactor and error serializer"
```

---

### Task 3: Memory-Safe Ring Buffer & Core Scoped Logger

**Files:**

- Create: `src/server/logger/ring-buffer.ts`
- Create: `src/server/logger/logger.ts`
- Create: `src/server/logger/index.ts`
- Modify: `src/server/logger.ts` (re-export singleton from `logger/index.ts` for 100% backwards compatibility)
- Test: `test/unit/logger-core.test.js`

**Interfaces:**

- Consumes: `types.ts`, `level.ts`, `formatters/`, `redactor.ts`, `error-serializer.ts`
- Produces:
  - `class LogRingBuffer { push(snapshot: LogEntrySnapshot): void; getRecent(count?: number): LogEntrySnapshot[]; clear(): void; }`
  - `class Logger { child(bindings: Record<string, unknown>): Logger; isLevelEnabled(level: string): boolean; getRingBuffer(): LogRingBuffer; }`
  - `export const logger: Logger;`
  - `export const createLogger: (options?: LoggerOptions) => Logger;`

- [ ] **Step 1: Write the failing test**

```javascript
// test/unit/logger-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../dist/server/logger/index.js';
import { LogLevel } from '../../dist/server/logger/level.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/logger-core.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement `ring-buffer.ts`, `logger.ts`, and `index.ts`**

Implement `LogRingBuffer` storing sanitized string snapshots. Implement `Logger` class with methods `trace`, `debug`, `info`, `warn`, `error`, `child`, `setLevel`, `isLevelEnabled`, with an early active-level gate. Re-export `logger` from `src/server/logger.ts` for backwards compatibility.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/unit/logger-core.test.js test/unit/error-hierarchy.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/logger/ring-buffer.ts src/server/logger/logger.ts src/server/logger/index.ts src/server/logger.ts test/unit/logger-core.test.js
git commit -m "feat(logger): implement Logger class, child scoping, and memory-safe ring buffer"
```

---

### Task 4: Stdio Protection Guard & MCP Logging Transport Integration

**Files:**

- Create: `src/server/logger/stdio-guard.ts`
- Create: `src/server/logger/mcp-transport.ts`
- Modify: `src/server/app.ts:31-43` (declare `capabilities: { logging: {} }`)
- Modify: `src/index.ts:25-38` (activate stdio guard in server mode and attach MCP transport)
- Test: `test/unit/logger-mcp-transport.test.js`
- Test: `test/unit/logger-stdio-guard.test.js`

**Interfaces:**

- Consumes: `@modelcontextprotocol/sdk/server/index.js (Server)`, `src/server/logger/types.ts`
- Produces:
  - `installStdioGuard(logger: Logger): () => void`
  - `attachMcpLogging(logger: Logger, server: Server): () => void`

- [ ] **Step 1: Write the failing tests**

```javascript
// test/unit/logger-mcp-transport.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../dist/server/logger/index.js';
import { attachMcpLogging } from '../../dist/server/logger/mcp-transport.js';
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

// test/unit/logger-stdio-guard.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../dist/server/logger/index.js';
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/unit/logger-mcp-transport.test.js test/unit/logger-stdio-guard.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement `stdio-guard.ts`, `mcp-transport.ts`, and update `app.ts`**

Implement `installStdioGuard` overriding `console.log` during stdio mode. Implement `attachMcpLogging` with level mapping (`warn` → `'warning'`), anti-reentrancy protection, and fire-and-forget promise error handling. Add `capabilities: { logging: {} }` in `createServer()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test test/unit/logger-mcp-transport.test.js test/unit/logger-stdio-guard.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/logger/stdio-guard.ts src/server/logger/mcp-transport.ts src/server/app.ts src/index.ts test/unit/logger-mcp-transport.test.js test/unit/logger-stdio-guard.test.js
git commit -m "feat(logger): implement stdio protocol guard and MCP logging transport"
```

---

### Task 5: Codebase Migration - Consolidate Scattered `console.error` Calls

**Files:**

- Modify: `src/server/app.ts:63-71`
- Modify: `src/server/env.ts:10-38`
- Modify: `src/server/services/symbol-embeddings.ts:170-215`
- Modify: `src/server/services/search/semantic-search.ts:260-270, 480-490`
- Modify: `src/server/services/search/local-gemma-provider.ts:90-150`
- Test: `test/unit/error-hierarchy.test.js`
- Test: `test/integration/mcp-protocol.test.js`

**Interfaces:**

- Consumes: `src/server/logger/index.js`
- Produces: Clean unified logging via child loggers (`const log = logger.child({ module: '...' })`), removing rogue `console.error` calls.

- [ ] **Step 1: Run existing test suite to ensure clean baseline**

Run: `npm test`  
Expected: PASS

- [ ] **Step 2: Refactor scattered `console.error` calls to scoped child loggers**

Replace bare `console.error` in `src/server/app.ts`, `src/server/env.ts`, `src/server/services/symbol-embeddings.ts`, `src/server/services/search/semantic-search.ts`, and `src/server/services/search/local-gemma-provider.ts` with dedicated `logger.child({ module: '...' })` instances.

- [ ] **Step 3: Run test suite to verify no regressions**

Run: `npm run check && npm test`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/app.ts src/server/env.ts src/server/services/symbol-embeddings.ts src/server/services/search/semantic-search.ts src/server/services/search/local-gemma-provider.ts
git commit -m "refactor(server): consolidate direct console.error calls into scoped child loggers"
```

---

### Task 6: CLI & Health Check Integration

**Files:**

- Modify: `src/server/services/doctor.ts` (add `logging_config` check preserving `DoctorReport` schema)
- Test: `test/unit/doctor.test.js`
- Test: `test/cli/doctor-cli.test.js`

**Interfaces:**

- Consumes: `logger.getRingBuffer().getRecent()`
- Produces: A non-breaking `logging_config` check in `runDoctor()` validating logging level, formatting mode, and reporting diagnostic error count if any exist.

- [ ] **Step 1: Write unit test verifying the `logging_config` check**

```javascript
// Add test in test/unit/doctor.test.js
test('runDoctor: includes logging_config check without mutating report structure', async () => {
	const report = await runDoctor(mockContext);
	const loggingCheck = report.checks.find((c) => c.id === 'logging_config');
	assert.ok(loggingCheck, 'Doctor report must include logging_config check');
	assert.equal(typeof loggingCheck.status, 'string');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/unit/doctor.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement `logging_config` check in `src/server/services/doctor.ts`**

Add check `id: 'logging_config'`, verifying that `LOG_LEVEL` is valid and reporting status `'ok'` (or `'warn'` if multiple runtime exceptions have accumulated in the ring buffer).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/unit/doctor.test.js test/cli/doctor-cli.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/services/doctor.ts test/unit/doctor.test.js
git commit -m "feat(doctor): add non-breaking logging configuration health check"
```

---

### Task 7: Full Verification & E2E MCP Stdio Protocol Protection Tests

**Files:**

- Create: `test/integration/logger-stdio-isolation.test.js`
- Modify: `test/cli/cli-launcher.test.js`

**Interfaces:**

- Consumes: All logger modules and CLI entrypoint
- Produces: Complete end-to-end verification proving stdout is 100% clean JSON-RPC.

- [ ] **Step 1: Write integration test for stdio protocol safety**

```javascript
// test/integration/logger-stdio-isolation.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const binPath = join(__dirname, '../../dist/index.js');

test('MCP stdio protocol isolation: stdout receives only valid JSON-RPC frames while logs go to stderr', async () => {
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run build && node --test test/integration/logger-stdio-isolation.test.js`  
Expected: PASS

- [ ] **Step 3: Run full validation suite**

Run: `npm run check && npm run test:all`  
Expected: ALL PASS with 0 lint errors, 0 type errors, 100% passing tests.

- [ ] **Step 4: Commit**

```bash
git add test/integration/logger-stdio-isolation.test.js test/cli/cli-launcher.test.js
git commit -m "test(logger): add end-to-end stdio protocol isolation and verification tests"
```
