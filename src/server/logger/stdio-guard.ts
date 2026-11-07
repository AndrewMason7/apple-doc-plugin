/**
 * Stdio Protection Guard
 *
 * Intercepts console.log and console.info during MCP stdio operation,
 * redirecting them to stderr through logger.info so that stray library
 * or application logs never corrupt the JSON-RPC wire protocol on stdout.
 */

import util from 'node:util';
import type { Logger } from './logger.js';
import { logger as rootLogger } from './index.js';

/**
 * Installs stdout protection by redirecting console.log and console.info to stderr
 * via the provided (or default) Logger. Returns an idempotent teardown function
 * restoring the original console methods.
 */
export function installStdioGuard(targetLogger?: Logger): () => void {
	const target = targetLogger ?? rootLogger;
	const originalLog = console.log;
	const originalInfo = console.info;

	console.log = (message?: unknown, ...optionalParams: unknown[]) => {
		try {
			if (message === undefined && optionalParams.length === 0) {
				target.info('');
			} else {
				target.info(util.format(message, ...optionalParams));
			}
		} catch {
			target.info(String(message));
		}
	};

	console.info = (message?: unknown, ...optionalParams: unknown[]) => {
		try {
			if (message === undefined && optionalParams.length === 0) {
				target.info('');
			} else {
				target.info(util.format(message, ...optionalParams));
			}
		} catch {
			target.info(String(message));
		}
	};

	let uninstalled = false;
	return () => {
		if (uninstalled) {
			return;
		}
		uninstalled = true;
		console.log = originalLog;
		console.info = originalInfo;
	};
}
