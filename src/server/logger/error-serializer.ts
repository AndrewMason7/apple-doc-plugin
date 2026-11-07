import type { SerializedError } from './types.js';
import {
	redactSensitiveText,
	redactSensitiveData,
	isSensitiveKey,
} from './redactor.js';

const MAX_CAUSE_DEPTH = 5;

/**
 * Safely normalizes Error instances, AggregateErrors, custom error objects,
 * or arbitrary thrown values into a structured, cycle-safe SerializedError.
 *
 * - Redacts credentials in error messages and stack traces
 * - Recursively resolves `cause` chains up to depth 5
 * - Cycle-safe via WeakSet, replacing circular causes with `[Circular]`
 * - Serializes AggregateError `errors` collections
 * - Preserves custom enumerable properties (e.g. code, status, errno)
 */
export function serializeError(
	err: unknown,
	seen: WeakSet<object> = new WeakSet(),
	depth: number = 0,
): SerializedError {
	if (depth >= MAX_CAUSE_DEPTH) {
		return {
			name: 'Error',
			message: '[MaxDepthExceeded]',
		};
	}

	if (err === null || err === undefined) {
		return {
			name: 'Error',
			message: 'Unknown error',
		};
	}

	if (typeof err === 'string') {
		return {
			name: 'Error',
			message: redactSensitiveText(err),
		};
	}

	if (
		typeof err === 'number' ||
		typeof err === 'boolean' ||
		typeof err === 'bigint' ||
		typeof err === 'symbol'
	) {
		return {
			name: 'Error',
			message: String(err),
		};
	}

	if (typeof err === 'function') {
		return {
			name: 'Error',
			message: err.name ? `[Function: ${err.name}]` : '[Function]',
		};
	}

	if (typeof err !== 'object') {
		return {
			name: 'Error',
			message: 'Unknown error',
		};
	}

	// Cycle detection for object
	if (seen.has(err)) {
		return {
			name: 'Error',
			message: '[Circular]',
		};
	}
	seen.add(err);

	const isErrorInstance = err instanceof Error;
	const errObj = err as Record<string, unknown>;

	const name =
		typeof errObj.name === 'string' && errObj.name.length > 0
			? errObj.name
			: 'Error';

	let rawMessage: string;
	if (typeof errObj.message === 'string') {
		rawMessage = errObj.message;
	} else if (typeof errObj.msg === 'string') {
		rawMessage = errObj.msg;
	} else if (isErrorInstance) {
		rawMessage = '';
	} else {
		rawMessage = 'Unknown error';
	}
	const message = redactSensitiveText(rawMessage);

	const serialized: SerializedError = {
		name,
		message,
	};

	if (typeof errObj.stack === 'string') {
		serialized.stack = redactSensitiveText(errObj.stack);
	}

	if (typeof errObj.code === 'string' || typeof errObj.code === 'number') {
		serialized.code = errObj.code;
	}

	// Handle `cause` property
	if ('cause' in errObj && errObj.cause !== undefined) {
		const cause = errObj.cause;
		if (typeof cause === 'object' && cause !== null && seen.has(cause)) {
			serialized.cause = '[Circular]';
		} else {
			serialized.cause = serializeError(cause, seen, depth + 1);
		}
	}

	// Handle AggregateError or custom `errors` array
	if (Array.isArray(errObj.errors)) {
		const childErrors: (SerializedError | string)[] = [];
		for (const subErr of errObj.errors) {
			if (typeof subErr === 'object' && subErr !== null && seen.has(subErr)) {
				childErrors.push('[Circular]');
			} else {
				childErrors.push(serializeError(subErr, seen, depth + 1));
			}
		}
		serialized.errors = childErrors;
	}

	// Preserve custom enumerable properties
	const standardKeys = new Set([
		'name',
		'message',
		'msg',
		'stack',
		'code',
		'cause',
		'errors',
		'__proto__',
		'constructor',
		'prototype',
	]);

	let keys: string[] = [];
	try {
		keys = Object.keys(errObj);
	} catch {
		keys = [];
	}

	for (const key of keys) {
		if (standardKeys.has(key)) {
			continue;
		}
		if (isSensitiveKey(key)) {
			serialized[key] = '[REDACTED]';
		} else {
			try {
				const val = errObj[key];
				serialized[key] = redactSensitiveData(val, { maxDepth: 3 });
			} catch {
				serialized[key] = '[Unreadable]';
			}
		}
	}

	return serialized;
}
