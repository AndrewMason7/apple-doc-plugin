import type { RedactOptions } from './types.js';
import { serializeError } from './error-serializer.js';

/**
 * Checks if an object property key name suggests sensitive content.
 * Matches common secret keys (password, token, secret, apiKey, cookie, authorization, etc.) case-insensitively.
 */
export function isSensitiveKey(key: string): boolean {
	if (!key || typeof key !== 'string') {
		return false;
	}
	const normalized = key.toLowerCase().replace(/[-_]/g, '');
	if (
		normalized.includes('password') ||
		normalized.includes('passwd') ||
		normalized.includes('secret') ||
		normalized.includes('apikey') ||
		normalized.includes('privatekey') ||
		normalized.includes('token') ||
		normalized.includes('credential') ||
		normalized.includes('cookie') ||
		normalized.includes('session') ||
		normalized.includes('authorization') ||
		normalized.includes('authentication')
	) {
		return true;
	}
	if (
		normalized === 'auth' ||
		(normalized.startsWith('auth') &&
			(key.includes('Token') ||
				key.includes('Header') ||
				key.includes('_') ||
				key.includes('-') ||
				normalized.includes('secret')))
	) {
		return true;
	}
	if (
		normalized.includes('cert') ||
		normalized.includes('certificate') ||
		normalized === 'signature'
	) {
		return true;
	}
	return false;
}

/**
 * Scans a string for known API keys, tokens, and private credentials,
 * replacing them with `[REDACTED]`.
 */
export function redactSensitiveText(text: string): string {
	if (typeof text !== 'string') {
		if (text === null || text === undefined) {
			return '';
		}
		return String(text);
	}
	if (!text) {
		return '';
	}

	let result = text;

	// Private key blocks
	result = result.replace(
		/-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/gi,
		'[REDACTED]',
	);

	// Google / Gemini API keys (AIza...)
	result = result.replace(/\bAIza[0-9A-Za-z-_]{16,}\b/g, '[REDACTED]');

	// OpenAI & Anthropic keys (sk-..., sk-ant-...)
	result = result.replace(/\bsk-(?:ant-)?[a-zA-Z0-9_-]{20,}\b/g, '[REDACTED]');

	// HuggingFace tokens (hf_...)
	result = result.replace(/\bhf_[a-zA-Z0-9]{20,}\b/g, '[REDACTED]');

	// GitHub tokens (ghp_..., gho_..., github_pat_...)
	result = result.replace(
		/\b(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{20,}\b/g,
		'[REDACTED]',
	);
	result = result.replace(/\bgithub_pat_[a-zA-Z0-9_]{20,}\b/g, '[REDACTED]');

	// AWS Access Key IDs (AKIA...)
	result = result.replace(
		/\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
		'[REDACTED]',
	);

	// Bearer tokens (Bearer eyJ...)
	result = result.replace(
		/\b(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
		'$1[REDACTED]',
	);

	// JWT tokens outside of Bearer header
	result = result.replace(
		/\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\b/g,
		'[REDACTED]',
	);

	// Basic auth embedded in URLs (https://user:pass@domain)
	result = result.replace(
		/((?:https?|ftp):\/\/[^:\/\s@]+:)([^@\/\s]+)(@)/gi,
		'$1[REDACTED]$3',
	);

	// Sensitive URL query parameters (?key=..., &token=..., etc.)
	result = result.replace(
		/([?&](?:key|token|api_?key|secret|password|passwd|auth|access_token|client_secret)=)[^&\s]+/gi,
		'$1[REDACTED]',
	);

	// Sensitive key=value or key: value in plain text (supports GEMINI_API_KEY=..., apiKey: ..., etc.)
	result = result.replace(
		/((?:password|passwd|client_secret|clientSecret|secretKey|(?:[a-zA-Z0-9_]+_)?api_?key|access_token|token|secret)\s*[:=]\s*["']?)[^\s"',;&]+(["']?)/gi,
		'$1[REDACTED]$2',
	);

	return result;
}

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_ARRAY_LENGTH = 25;
const DEFAULT_MAX_STRING_LENGTH = 2000;

function redactInternal(
	val: unknown,
	options: Required<RedactOptions>,
	depth: number,
	seen: WeakSet<object>,
): unknown {
	if (val === null || val === undefined) {
		return val;
	}

	if (typeof val === 'string') {
		let s = val;
		if (s.length > options.maxStringLength) {
			s = s.slice(0, options.maxStringLength) + '... [truncated]';
		}
		return redactSensitiveText(s);
	}

	if (
		typeof val === 'number' ||
		typeof val === 'boolean' ||
		typeof val === 'symbol' ||
		typeof val === 'bigint'
	) {
		return val;
	}

	if (typeof val === 'function') {
		return val.name ? `[Function: ${val.name}]` : '[Function]';
	}

	if (typeof val !== 'object') {
		return val;
	}

	// Circular reference protection
	if (seen.has(val)) {
		return '[Circular]';
	}

	// Bounded depth check
	if (depth >= options.maxDepth) {
		return '[MaxDepthExceeded]';
	}

	// Date handling
	if (val instanceof Date) {
		return !Number.isNaN(val.getTime()) ? val.toISOString() : '[Invalid Date]';
	}

	// RegExp handling
	if (val instanceof RegExp) {
		return val.toString();
	}

	// Buffer or TypedArray handling
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
		return `[Buffer ${val.length} bytes]`;
	}
	if (ArrayBuffer.isView(val)) {
		return `[TypedArray ${val.byteLength} bytes]`;
	}

	// Error handling (serializeError handles its own cycle tracking via seen)
	if (val instanceof Error) {
		return serializeError(val, seen, depth);
	}

	// Track object in WeakSet
	seen.add(val);

	// Array handling
	if (Array.isArray(val)) {
		const result: unknown[] = [];
		const len = Math.min(val.length, options.maxArrayLength);
		for (let i = 0; i < len; i++) {
			result.push(redactInternal(val[i], options, depth + 1, seen));
		}
		if (val.length > options.maxArrayLength) {
			result.push(`[+${val.length - options.maxArrayLength} more items]`);
		}
		return result;
	}

	// Plain / general object handling with getter safety
	const result: Record<string, unknown> = {};
	let keys: string[] = [];
	try {
		keys = Object.keys(val);
	} catch {
		return '[UnreadableObject]';
	}

	for (const key of keys) {
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
			continue;
		}
		if (isSensitiveKey(key)) {
			result[key] = '[REDACTED]';
		} else {
			try {
				const propVal = (val as Record<string, unknown>)[key];
				result[key] = redactInternal(propVal, options, depth + 1, seen);
			} catch {
				result[key] = '[Unreadable]';
			}
		}
	}
	return result;
}

/**
 * Deeply sanitizes arbitrary data structures (objects, arrays, primitives):
 * - Masks sensitive keys (password, token, apiKey, secret, etc.) with `[REDACTED]`
 * - Redacts sensitive tokens and credentials in strings via `redactSensitiveText`
 * - Bounded traversal with default depth 5, array length 25, string length 2000
 * - Cycle-safe using WeakSet, replacing circular references with `[Circular]`
 */
export function redactSensitiveData<T>(obj: T, options?: RedactOptions): T {
	const resolvedOptions: Required<RedactOptions> = {
		maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
		maxArrayLength: options?.maxArrayLength ?? DEFAULT_MAX_ARRAY_LENGTH,
		maxStringLength: options?.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
	};

	const seen = new WeakSet<object>();
	return redactInternal(obj, resolvedOptions, 0, seen) as T;
}
