import util from 'node:util';
import type { LogEntry } from '../types.js';
import { LOG_LEVEL_NAMES } from '../level.js';

/**
 * Formats a LogEntry into a single-line JSON string conforming to OpenTelemetry/ECS fields.
 */
export function formatJsonEntry(entry: LogEntry): string {
	const timestamp =
		entry.timestamp instanceof Date
			? entry.timestamp.toISOString()
			: new Date(entry.timestamp).toISOString();

	const level = (
		entry.levelName ||
		LOG_LEVEL_NAMES[entry.level] ||
		'info'
	).toLowerCase();

	const message =
		entry.args && entry.args.length > 0
			? util.format(entry.message, ...entry.args)
			: entry.message;

	const payload: Record<string, unknown> = {
		timestamp,
		level,
		message,
	};

	if (entry.bindings) {
		Object.assign(payload, entry.bindings);
	}

	if (entry.module && !payload.module) {
		payload.module = entry.module;
	}

	if (entry.error && !payload.error) {
		payload.error =
			entry.error instanceof Error
				? {
						name: entry.error.name,
						message: entry.error.message,
						stack: entry.error.stack,
					}
				: entry.error;
	}

	if (entry.data !== undefined && payload.data === undefined) {
		payload.data = entry.data;
	}

	try {
		return JSON.stringify(payload);
	} catch {
		const seen = new WeakSet();
		return JSON.stringify(payload, (_key, value) => {
			if (typeof value === 'bigint') {
				return value.toString();
			}
			if (typeof value === 'object' && value !== null) {
				if (seen.has(value)) {
					return '[Circular]';
				}
				seen.add(value);
			}
			return value;
		});
	}
}
