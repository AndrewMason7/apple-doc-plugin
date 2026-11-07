import util from 'node:util';
import type { LogEntry } from '../types.js';
import { LOG_LEVEL_NAMES } from '../level.js';

/**
 * Formats a LogEntry into human-readable text badge format:
 * `[<ISO_TIMESTAMP>] [<LEVEL_NAME>] [<MODULE>] <MESSAGE>`
 */
export function formatTextEntry(entry: LogEntry): string {
	const timestamp =
		entry.timestamp instanceof Date
			? entry.timestamp.toISOString()
			: new Date(entry.timestamp).toISOString();

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
			extraBindingsStr = ' ' + JSON.stringify(Object.fromEntries(extra));
		}
	}

	return `[${timestamp}] [${levelName}]${moduleTag} ${message}${extraBindingsStr}`;
}
