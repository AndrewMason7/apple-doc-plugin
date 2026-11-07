import util from 'node:util';
import type { LogEntry } from '../types.js';
import { LOG_LEVEL_NAMES } from '../level.js';

function formatTimestamp(timestamp?: unknown): string {
	if (timestamp instanceof Date) {
		const time = timestamp.getTime();
		if (!Number.isNaN(time)) {
			return timestamp.toISOString();
		}
	} else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
		const parsed = new Date(timestamp);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed.toISOString();
		}
	}
	return new Date().toISOString();
}

function safeStringify(value: unknown): string {
	const seen = new WeakSet();
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === 'bigint') {
			return val.toString();
		}
		if (typeof val === 'object' && val !== null) {
			if (seen.has(val)) {
				return '[Circular]';
			}
			seen.add(val);
		}
		return val;
	});
}

/**
 * Formats a LogEntry into human-readable text badge format:
 * `[<ISO_TIMESTAMP>] [<LEVEL_NAME>] [<MODULE>] <MESSAGE>`
 */
export function formatTextEntry(entry: LogEntry): string {
	const timestamp = formatTimestamp(entry.timestamp);

	const levelName = (
		entry.levelName ||
		LOG_LEVEL_NAMES[entry.level] ||
		'INFO'
	).toUpperCase();

	const module = entry.module ?? (entry.bindings?.module as string | undefined);
	const moduleTag = module ? ` [${module}]` : '';

	const message =
		entry.args && entry.args.length > 0
			? util.format(entry.message, ...entry.args)
			: entry.message;

	let extraBindingsStr = '';
	if (entry.bindings) {
		const extra = Object.entries(entry.bindings).filter(
			([k]) => k !== 'module',
		);
		if (extra.length > 0) {
			extraBindingsStr = ' ' + safeStringify(Object.fromEntries(extra));
		}
	}

	let errorSuffix = '';
	if (entry.error) {
		if (entry.error instanceof Error) {
			errorSuffix = `\n${entry.error.stack || entry.error.message}`;
		} else if (typeof entry.error === 'object' && entry.error !== null) {
			const errObj = entry.error as Record<string, unknown>;
			errorSuffix = `\n${errObj.stack || errObj.message || safeStringify(entry.error)}`;
		} else {
			errorSuffix = `\n${String(entry.error)}`;
		}
	}

	return `[${timestamp}] [${levelName}]${moduleTag} ${message}${extraBindingsStr}${errorSuffix}`;
}
