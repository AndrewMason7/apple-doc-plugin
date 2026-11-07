# Production-Grade Logging Architecture & System Design Spec (Hardened)

**Date:** 2026-11-07  
**Status:** Approved / Ready for Implementation  
**Target:** `apple-doc-plugin` (MCP Server & CLI)

---

## 1. Executive Summary & Defect Remediation

The logging implementation in `src/server/logger.ts` was an unconfigurable 16-line wrapper around `console.error`. This specification defines an enterprise-grade, zero-dependency logging engine designed specifically for the Model Context Protocol (MCP) and Node.js CLI environments.

### Remediated Architectural Risks

1. **MCP Capability Negotiation**: Declares `capabilities: { logging: {} }` in the MCP Server constructor and implements client `logging/setLevel` compatibility.
2. **MCP Level Mapping**: Translates internal levels (`warn` → `'warning'`, `trace` → `'debug'`) to strictly satisfy the MCP SDK's Zod schema.
3. **Async/Sync Decoupling**: Maintains a strictly synchronous public API (`logger.info(...)`) while dispatching MCP protocol notifications asynchronously with isolated `.catch()` handlers, preventing UnhandledPromiseRejection crashes.
4. **Re-Entrancy Protection**: Prevents cyclic recursion if `server.sendLoggingMessage()` triggers an internal log event.
5. **Fast-Path Level Gate & Bounded Redaction**: Checks active log levels before performing string interpolation or object traversal. Deep traversal is bounded (depth: 5, array length: 25, string length: 2000) with `WeakSet` circular reference protection to prevent event-loop stalls.
6. **Memory-Safe Ring Buffer**: Stores compact, sanitized metadata snapshots instead of raw argument object references, preventing memory leaks during long-running server sessions.
7. **Stdio Protocol Guard**: Intercepts accidental `console.log` calls in stdio server mode, redirecting them to `stderr` through `logger.info`, ensuring `stdout` contains only pristine JSON-RPC frames.
8. **Doctor Integration without Schema Mutation**: Preserves the exact `DoctorReport` contract and adds an isolated `logging_config` check.

---

## 2. Architectural Boundaries & Separation of Concerns (SoC)

```
src/server/logger/
├── types.ts              # TypeScript interfaces, LogLevel, LogEntry, LoggerOptions
├── level.ts              # Numeric weights, parsing, and level comparison
├── redactor.ts           # Pure sanitization of secrets (API keys, tokens, paths)
├── error-serializer.ts   # Pure error normalization (cause chains, stacks, codes)
├── ring-buffer.ts        # Memory-safe, fixed-capacity circular snapshot queue
├── formatters/
│   ├── text.ts           # Human-readable formatter with ISO timestamps & badges
│   └── json.ts           # Single-line JSON conforming to OpenTelemetry/ECS
├── logger.ts             # Orchestrator: early level gate, child loggers, sink dispatch
├── mcp-transport.ts      # MCP protocol bridge: anti-reentrancy, level mapping
├── stdio-guard.ts        # stdout protection diverting console.log to stderr
└── index.ts              # Singleton instance and createLogger factory
```

---

## 3. Configuration & Environment Variables

| Variable        | Values                                              | Default                                                    | Purpose                          |
| :-------------- | :-------------------------------------------------- | :--------------------------------------------------------- | :------------------------------- |
| `LOG_LEVEL`     | `trace`, `debug`, `info`, `warn`, `error`, `silent` | `info` (or `debug` if `DEBUG=1` or `NODE_ENV=development`) | Minimum severity threshold       |
| `LOG_FORMAT`    | `text`, `json`                                      | `text` (or auto-detected)                                  | Output serialization format      |
| `LOG_REDACT`    | `true`, `false`                                     | `true`                                                     | Credential and secret masking    |
| `LOG_RING_SIZE` | integer (1–1000)                                    | `100`                                                      | In-memory diagnostic buffer size |

---

## 4. MCP Protocol Specification Compliance

The Model Context Protocol specification (`LoggingLevelSchema`) defines eight severity levels:
`'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency'`

Mapping Matrix:

- Internal `TRACE` (10) → MCP `'debug'`
- Internal `DEBUG` (20) → MCP `'debug'`
- Internal `INFO` (30) → MCP `'info'`
- Internal `WARN` (40) → MCP `'warning'` (NOTE: Not `'warn'`)
- Internal `ERROR` (50) → MCP `'error'`

Notification Dispatch:

```typescript
if (mcpServer && isConnected && !isDispatching) {
	isDispatching = true;
	mcpServer
		.sendLoggingMessage({
			level: mcpLevel,
			data: sanitizedMessage,
			logger: entry.module ?? 'apple-doc-plugin',
		})
		.catch(() => {})
		.finally(() => {
			isDispatching = false;
		});
}
```
