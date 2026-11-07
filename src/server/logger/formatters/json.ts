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

/**
 * Formats a LogEntry into a single-line JSON string conforming to OpenTelemetry/ECS fields.
 */
export function formatJsonEntry(entry: LogEntry): string {
	const timestamp = formatTimestamp(entry.timestamp);

	const level = (
		entry.levelName ||
		LOG_LEVEL_NAMES[entry.level] ||
		'info'
	).toLowerCase();

	const message =
		entry.args && entry.args.length > 0
			? util.format(entry.message, ...entry.args)
			: entry.message;

	const payload: Record<string, unknown> = {};

	// Spread bindings first so standard envelope fields cannot be overwritten
	if (entry.bindings) {
		Object.assign(payload, entry.bindings);
	}

	if (entry.module && !payload.module) {
		payload.module = entry.module;
	}

	if (entry.data !== undefined && payload.data === undefined) {
		payload.data = entry.data;
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

	// Envelope fields take precedence over bindings
	payload.timestamp = timestamp;
	payload.level = level;
	payload.message = message;

	try {
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
	} catch (err) {
		return JSON.stringify({
			timestamp,
			level: 'error',
			message: `Failed to serialize log entry: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
}
