import type { LoggerOptions } from './types.js';
import { LogLevel } from './types.js';
import { parseLogLevel } from './level.js';
import { Logger } from './logger.js';
import { LogRingBuffer } from './ring-buffer.js';

function resolveDefaultOptions(options?: LoggerOptions): LoggerOptions {
	let level: LogLevel;
	if (options?.level !== undefined) {
		level =
			typeof options.level === 'number'
				? options.level
				: parseLogLevel(options.level);
	} else if (process.env.LOG_LEVEL) {
		level = parseLogLevel(process.env.LOG_LEVEL);
	} else if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
		level = LogLevel.DEBUG;
	} else {
		level = LogLevel.INFO;
	}

	let format: 'text' | 'json';
	if (options?.format !== undefined) {
		format = options.format === 'json' ? 'json' : 'text';
	} else if (process.env.LOG_FORMAT) {
		format =
			process.env.LOG_FORMAT.trim().toLowerCase() === 'json' ? 'json' : 'text';
	} else {
		format = 'text';
	}

	let redact: boolean;
	if (options?.redact !== undefined) {
		redact = Boolean(options.redact);
	} else if (process.env.LOG_REDACT !== undefined) {
		const val = process.env.LOG_REDACT.trim().toLowerCase();
		redact = val !== 'false' && val !== '0' && val !== 'no';
	} else {
		redact = true;
	}

	let ringBufferSize: number;
	if (options?.ringBufferSize !== undefined) {
		ringBufferSize = options.ringBufferSize;
	} else if (process.env.LOG_RING_SIZE) {
		const parsed = parseInt(process.env.LOG_RING_SIZE, 10);
		ringBufferSize = Number.isNaN(parsed) || parsed <= 0 ? 100 : parsed;
	} else {
		ringBufferSize = 100;
	}

	return {
		level,
		format,
		redact,
		ringBufferSize,
		destination: options?.destination,
		bindings: options?.bindings,
	};
}

/**
 * Creates a configured Logger instance.
 */
export function createLogger(options?: LoggerOptions): Logger {
	const resolved = resolveDefaultOptions(options);
	return new Logger(resolved);
}

/**
 * Root singleton logger initialized from process environment variables.
 */
export const logger: Logger = createLogger();

export { Logger };
export { LogRingBuffer };
export * from './types.js';
export { parseLogLevel, LOG_LEVEL_NAMES, NAME_TO_LOG_LEVEL } from './level.js';
export * from './formatters/index.js';
export * from './redactor.js';
export * from './error-serializer.js';
