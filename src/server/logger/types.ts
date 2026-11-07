/**
 * Core logging types and interfaces for apple-doc-plugin.
 */

export enum LogLevel {
	TRACE = 10,
	DEBUG = 20,
	INFO = 30,
	WARN = 40,
	ERROR = 50,
	SILENT = 60,
}

export type LogLevelName =
	| 'trace'
	| 'debug'
	| 'info'
	| 'warn'
	| 'warning'
	| 'error'
	| 'silent';

export type LogFormat = 'text' | 'json';

export interface SerializedError {
	name: string;
	message: string;
	stack?: string;
	code?: string | number;
	cause?: SerializedError;
	[key: string]: unknown;
}

export interface RedactOptions {
	maxDepth?: number;
	maxArrayLength?: number;
	maxStringLength?: number;
}

export interface LogEntry {
	timestamp: Date;
	level: LogLevel;
	levelName: string;
	message: string;
	module?: string;
	bindings?: Record<string, unknown>;
	args?: unknown[];
	error?: Error | SerializedError | unknown;
	data?: unknown;
	[key: string]: unknown;
}

export interface LogEntrySnapshot {
	timestamp: string;
	level: string;
	module?: string;
	message: string;
	details?: unknown;
}

export type LogDestination = (message: string, entry?: LogEntry) => void;

export interface LoggerOptions {
	level?: LogLevel | string;
	format?: LogFormat | string;
	destination?: LogDestination | ((message: string) => void);
	redact?: boolean;
	ringBufferSize?: number;
	bindings?: Record<string, unknown>;
}

export interface FormatOptions {
	colorize?: boolean;
}

export interface ILogger {
	trace(msg: string, ...args: unknown[]): void;
	debug(msg: string, ...args: unknown[]): void;
	info(msg: string, ...args: unknown[]): void;
	warn(msg: string, ...args: unknown[]): void;
	error(msg: string, ...args: unknown[]): void;
	child(bindings: Record<string, unknown>): ILogger;
	setLevel(level: LogLevel | string): void;
	getLevel(): LogLevel;
	isLevelEnabled(level: LogLevel | string): boolean;
}
