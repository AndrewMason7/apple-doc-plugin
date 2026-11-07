import { LogLevel } from './types.js';

export { LogLevel };

export const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
	[LogLevel.TRACE]: 'trace',
	[LogLevel.DEBUG]: 'debug',
	[LogLevel.INFO]: 'info',
	[LogLevel.WARN]: 'warn',
	[LogLevel.ERROR]: 'error',
	[LogLevel.SILENT]: 'silent',
};

export const NAME_TO_LOG_LEVEL: Record<string, LogLevel> = {
	trace: LogLevel.TRACE,
	debug: LogLevel.DEBUG,
	info: LogLevel.INFO,
	warn: LogLevel.WARN,
	warning: LogLevel.WARN,
	error: LogLevel.ERROR,
	silent: LogLevel.SILENT,
};

/**
 * Parses a string log level name into a numeric LogLevel enum value.
 * Performs case-insensitive matching and strips surrounding whitespace.
 *
 * @param name - The level name to parse (e.g. 'debug', 'WARN', 'info')
 * @param defaultLevel - Fallback level if name is undefined or unrecognized (defaults to INFO)
 */
export function parseLogLevel(
	name?: string,
	defaultLevel: LogLevel = LogLevel.INFO,
): LogLevel {
	if (!name) {
		return defaultLevel;
	}
	const normalized = name.trim().toLowerCase();
	const level = NAME_TO_LOG_LEVEL[normalized];
	return level !== undefined ? level : defaultLevel;
}
