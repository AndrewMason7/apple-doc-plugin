/**
 * Stdio Protection Guard
 *
 * Intercepts console.log, console.info, console.warn, console.debug, and console.dir
 * during MCP stdio operation, redirecting them to stderr through logger so that stray
 * library or application logs never corrupt the JSON-RPC wire protocol on stdout.
 */

import util from 'node:util';
import type { Logger } from './logger.js';
import { logger as rootLogger } from './index.js';

/**
 * Installs stdout protection by redirecting console.log, console.info, console.warn,
 * console.debug, and console.dir to stderr via the provided (or default) Logger.
 * Returns an idempotent teardown function restoring the original console methods.
 */
export function installStdioGuard(targetLogger?: Logger): () => void {
	const target = targetLogger ?? rootLogger;
	const originalLog = console.log;
	const originalInfo = console.info;
	const originalWarn = console.warn;
	const originalDebug = console.debug;
	const originalDir = console.dir;

	console.log = (...args: unknown[]) => {
		try {
			if (args.length === 0) {
				target.info('');
			} else {
				target.info(util.format(...args));
			}
		} catch {
			target.info(String(args[0]));
		}
	};

	console.info = (...args: unknown[]) => {
		try {
			if (args.length === 0) {
				target.info('');
			} else {
				target.info(util.format(...args));
			}
		} catch {
			target.info(String(args[0]));
		}
	};

	console.warn = (...args: unknown[]) => {
		try {
			if (args.length === 0) {
				target.warn('');
			} else {
				target.warn(util.format(...args));
			}
		} catch {
			target.warn(String(args[0]));
		}
	};

	console.debug = (...args: unknown[]) => {
		try {
			if (args.length === 0) {
				target.debug('');
			} else {
				target.debug(util.format(...args));
			}
		} catch {
			target.debug(String(args[0]));
		}
	};

	console.dir = (...args: unknown[]) => {
		try {
			if (args.length === 0) {
				target.info('');
			} else {
				const [item, options] = args;
				target.info(
					typeof options === 'object' && options !== null
						? util.inspect(item, options as util.InspectOptions)
						: util.inspect(item),
				);
			}
		} catch {
			target.info(String(args[0]));
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
		console.warn = originalWarn;
		console.debug = originalDebug;
		console.dir = originalDir;
	};
}
