import util from 'node:util';
import type {
	LogEntry,
	LogEntrySnapshot,
	LogDestination,
	LoggerOptions,
	ILogger,
	SerializedError,
} from './types.js';
import { LogLevel } from './types.js';
import { parseLogLevel, LOG_LEVEL_NAMES } from './level.js';
import { formatTextEntry, formatJsonEntry } from './formatters/index.js';
import { redactSensitiveText, redactSensitiveData } from './redactor.js';
import { serializeError } from './error-serializer.js';
import { LogRingBuffer } from './ring-buffer.js';

interface LevelState {
	level: LogLevel;
}

export type LogSubscriber = (entry: LogEntry) => void;

export interface InternalLoggerConfig extends LoggerOptions {
	levelState?: LevelState;
	subscribers?: Set<LogSubscriber>;
	ringBuffer?: LogRingBuffer;
}

const defaultDestination: LogDestination = (message: string) => {
	process.stderr.write(message + '\n');
};

/**
 * Enterprise-grade, zero-dependency Logger implementing ILogger.
 * Supports early active-level fast path (< 5ns), scoped child loggers,
 * credential redaction, error serialization, memory-safe ring buffering,
 * and protocol subscriber hooks.
 */
export class Logger implements ILogger {
	private levelState: LevelState;
	private format: 'text' | 'json';
	private redact: boolean;
	private destination: LogDestination;
	private ringBuffer: LogRingBuffer;
	private subscribers: Set<LogSubscriber>;
	private bindings: Record<string, unknown>;

	constructor(options: InternalLoggerConfig = {}) {
		if (options.levelState) {
			this.levelState = options.levelState;
		} else {
			const initialLevel =
				options.level !== undefined
					? typeof options.level === 'number'
						? options.level
						: parseLogLevel(options.level)
					: LogLevel.INFO;
			this.levelState = { level: initialLevel };
		}

		this.format = options.format === 'json' ? 'json' : 'text';
		this.redact = options.redact ?? true;
		this.destination = options.destination ?? defaultDestination;

		this.ringBuffer =
			options.ringBuffer ?? new LogRingBuffer(options.ringBufferSize ?? 100);

		this.subscribers = options.subscribers ?? new Set();
		this.bindings = options.bindings ? { ...options.bindings } : {};
	}

	get activeLevel(): LogLevel {
		return this.levelState.level;
	}

	set activeLevel(level: LogLevel) {
		this.levelState.level = level;
	}

	/**
	 * Fast-path logging dispatcher.
	 */
	private log(
		level: LogLevel,
		levelName: string,
		rawMsg: unknown,
		args: unknown[],
	): void {
		// Fast-path early active level check (< 5ns)
		if (level < this.levelState.level) {
			return;
		}

		let msgStr: string;
		let primaryError: unknown = undefined;

		if (rawMsg instanceof Error) {
			msgStr = rawMsg.message;
			primaryError = rawMsg;
		} else if (typeof rawMsg === 'string') {
			msgStr = rawMsg;
		} else if (rawMsg === null || rawMsg === undefined) {
			msgStr = '';
		} else {
			msgStr = String(rawMsg);
		}

		let errorObj: SerializedError | undefined = undefined;
		const remainingArgs: unknown[] = [];

		if (primaryError) {
			errorObj = serializeError(primaryError);
			for (const arg of args) {
				remainingArgs.push(arg);
			}
		} else {
			for (const arg of args) {
				if (
					!errorObj &&
					(arg instanceof Error ||
						(typeof arg === 'object' &&
							arg !== null &&
							'message' in arg &&
							'stack' in arg))
				) {
					errorObj = serializeError(arg);
				} else {
					remainingArgs.push(arg);
				}
			}
		}

		if (!errorObj && this.bindings.error) {
			errorObj = serializeError(this.bindings.error);
		}

		const safeMsg = this.redact ? redactSensitiveText(msgStr) : msgStr;
		const safeArgs = this.redact
			? (remainingArgs.map((arg) => redactSensitiveData(arg)) as unknown[])
			: remainingArgs;
		const safeBindings = this.redact
			? (redactSensitiveData(this.bindings) as Record<string, unknown>)
			: this.bindings;

		const timestamp = new Date();
		const moduleName =
			typeof safeBindings.module === 'string' ? safeBindings.module : undefined;

		const entry: LogEntry = {
			timestamp,
			level,
			levelName,
			message: safeMsg,
			module: moduleName,
			bindings: Object.keys(safeBindings).length > 0 ? safeBindings : undefined,
			args: safeArgs.length > 0 ? safeArgs : undefined,
			error: errorObj,
		};

		// Format output for sink
		const formatted =
			this.format === 'json' ? formatJsonEntry(entry) : formatTextEntry(entry);

		// Dispatch to destination (stderr default)
		try {
			this.destination(formatted, entry);
		} catch {
			try {
				process.stderr.write(formatted + '\n');
			} catch {
				// Silently guard in case stderr closed
			}
		}

		// Push to memory-safe ring buffer
		const formattedMsg =
			safeArgs.length > 0 ? util.format(safeMsg, ...safeArgs) : safeMsg;

		const snapshot: LogEntrySnapshot = {
			timestamp: timestamp.toISOString(),
			level: levelName,
			module: moduleName,
			message: formattedMsg,
			details:
				errorObj ??
				(Object.keys(safeBindings).length > 0 ? safeBindings : undefined),
		};

		this.ringBuffer.push(snapshot);

		// Notify subscribers (MCP protocol transport, etc.)
		this.notifySubscribers(entry);
	}

	private notifySubscribers(entry: LogEntry): void {
		for (const subscriber of this.subscribers) {
			try {
				subscriber(entry);
			} catch {
				// Prevent subscriber failures from breaking logger
			}
		}
	}

	trace(msg: string, ...args: unknown[]): void {
		this.log(10, 'trace', msg, args);
	}

	debug(msg: string, ...args: unknown[]): void {
		this.log(20, 'debug', msg, args);
	}

	info(msg: string, ...args: unknown[]): void {
		this.log(30, 'info', msg, args);
	}

	warn(msg: string, ...args: unknown[]): void {
		this.log(40, 'warn', msg, args);
	}

	error(msg: string, ...args: unknown[]): void {
		this.log(50, 'error', msg, args);
	}

	child(bindings: Record<string, unknown>): Logger {
		const mergedBindings = {
			...this.bindings,
			...bindings,
		};

		return new Logger({
			levelState: this.levelState,
			format: this.format,
			redact: this.redact,
			destination: this.destination,
			ringBuffer: this.ringBuffer,
			subscribers: this.subscribers,
			bindings: mergedBindings,
		});
	}

	setLevel(level: LogLevel | string): void {
		const parsed =
			typeof level === 'number'
				? level
				: parseLogLevel(level, this.levelState.level);
		this.levelState.level = parsed;
	}

	getLevel(): LogLevel {
		return this.levelState.level;
	}

	getLevelName(): string {
		return LOG_LEVEL_NAMES[this.levelState.level] ?? 'info';
	}

	isLevelEnabled(level: LogLevel | string): boolean {
		const numeric = typeof level === 'number' ? level : parseLogLevel(level);
		return numeric >= this.levelState.level;
	}

	getRingBuffer(): LogRingBuffer {
		return this.ringBuffer;
	}

	subscribe(fn: LogSubscriber): () => void {
		this.subscribers.add(fn);
		return () => {
			this.subscribers.delete(fn);
		};
	}

	getBindings(): Record<string, unknown> {
		return { ...this.bindings };
	}
}
