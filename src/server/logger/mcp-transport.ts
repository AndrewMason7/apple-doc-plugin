/**
 * MCP Protocol Logging Transport Integration
 *
 * Connects the internal logging subsystem with the Model Context Protocol (MCP)
 * notifications/message wire channel, providing:
 * - Schema-compliant severity mapping (warn -> warning, trace -> debug)
 * - Re-entrancy protection against cyclic log dispatching
 * - Fire-and-forget async promise rejection absorption
 */

import util from 'node:util';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from './logger.js';
import { LogLevel } from './types.js';
import type { LogEntry } from './types.js';

export interface McpLoggingServer {
	sendLoggingMessage(params: {
		level: LoggingLevel;
		data: unknown;
		logger?: string;
	}): Promise<void> | unknown;
	setRequestHandler?: (
		schema: unknown,
		handler: (request: any, extra?: any) => Promise<any> | any,
	) => void;
}

/**
 * Maps internal LogLevel to standard Model Context Protocol (MCP) severity levels.
 * MCP specification requires 'warning' rather than 'warn'.
 */
export function mapToMcpLogLevel(level: LogLevel): LoggingLevel {
	switch (level) {
		case LogLevel.TRACE:
		case LogLevel.DEBUG:
			return 'debug';
		case LogLevel.INFO:
			return 'info';
		case LogLevel.WARN:
			return 'warning';
		case LogLevel.ERROR:
		case LogLevel.SILENT:
			return 'error';
		default:
			if (level < LogLevel.INFO) {
				return 'debug';
			} else if (level < LogLevel.WARN) {
				return 'info';
			} else if (level < LogLevel.ERROR) {
				return 'warning';
			}
			return 'error';
	}
}

/**
 * Attaches an MCP Server to a Logger instance so log events are forwarded
 * as notifications/message over the MCP JSON-RPC protocol.
 *
 * Implements:
 * - RFC-compliant level translation (e.g. warn -> warning)
 * - Anti-reentrancy locking to avoid loops from logging within transport handlers
 * - Fire-and-forget Promise error handling preventing UnhandledPromiseRejection
 * - Dynamic unsubscription teardown
 */
export function attachMcpLogging(
	targetLogger: Logger,
	server: Server | McpLoggingServer,
): () => void {
	if (!targetLogger || typeof targetLogger.subscribe !== 'function') {
		return () => {};
	}

	if (
		!server ||
		typeof (server as McpLoggingServer).sendLoggingMessage !== 'function'
	) {
		return () => {};
	}

	// Register setLevel handler on MCP server if supported
	if (
		typeof (server as { setRequestHandler?: unknown }).setRequestHandler ===
		'function'
	) {
		try {
			(
				server as {
					setRequestHandler: (
						schema: unknown,
						handler: (request: {
							params: { level: LoggingLevel };
						}) => Promise<Record<string, never>>,
					) => void;
				}
			).setRequestHandler(SetLevelRequestSchema, async (request) => {
				targetLogger.setLevel(request.params.level);
				return {};
			});
		} catch {
			// Ignore if setRequestHandler fails or is unsupported
		}
	}

	let isDispatching = false;

	const unsubscribe = targetLogger.subscribe((entry: LogEntry) => {
		if (isDispatching) {
			return;
		}

		const mcpLevel = mapToMcpLogLevel(entry.level);
		let data =
			entry.args && entry.args.length > 0
				? util.format(entry.message, ...entry.args)
				: entry.message;

		if (entry.error) {
			if (entry.error instanceof Error) {
				data += `\n${entry.error.stack || entry.error.message}`;
			} else if (typeof entry.error === 'object' && entry.error !== null) {
				const errObj = entry.error as Record<string, unknown>;
				let fallback: string;
				try {
					fallback = JSON.stringify(entry.error);
				} catch {
					fallback = String(entry.error);
				}
				data += `\n${errObj.stack || errObj.message || fallback}`;
			} else {
				data += `\n${String(entry.error)}`;
			}
		}
		const loggerName =
			entry.module ??
			(entry.bindings?.module as string | undefined) ??
			'apple-doc-plugin';

		isDispatching = true;
		try {
			const promise = server.sendLoggingMessage({
				level: mcpLevel,
				data,
				logger: loggerName,
			});

			if (promise && typeof (promise as Promise<void>).catch === 'function') {
				(promise as Promise<void>).catch(() => {});
			}
		} catch {
			// Catch synchronous errors from sendLoggingMessage
		} finally {
			isDispatching = false;
		}
	});

	return unsubscribe;
}
