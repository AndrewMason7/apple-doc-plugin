import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	redactSensitiveText,
	redactSensitiveData,
} from '../../dist/server/logger/redactor.js';
import { serializeError } from '../../dist/server/logger/error-serializer.js';

test('redactSensitiveText: masks API keys, bearer tokens, and private credentials', () => {
	const raw =
		'Request failed with key AIzaSyD1234567890abcdef and token Bearer eyJhbGciOiJIUzI1NiJ9';
	const sanitized = redactSensitiveText(raw);
	assert.doesNotMatch(sanitized, /AIzaSyD1234567890abcdef/);
	assert.doesNotMatch(sanitized, /eyJhbGciOiJIUzI1NiJ9/);
	assert.match(sanitized, /\[REDACTED\]/);
});

test('redactSensitiveText: masks various known secret patterns and query parameters', () => {
	// OpenAI key
	assert.match(
		redactSensitiveText('sk-abcdef1234567890abcdef1234567890'),
		/\[REDACTED\]/,
	);
	// HuggingFace token
	assert.match(
		redactSensitiveText('hf_1234567890abcdef1234567890'),
		/\[REDACTED\]/,
	);
	// GitHub personal access token
	assert.match(
		redactSensitiveText('ghp_1234567890abcdef1234567890123456'),
		/\[REDACTED\]/,
	);
	// AWS Access Key ID
	assert.match(redactSensitiveText('AKIAIOSFODNN7EXAMPLE'), /\[REDACTED\]/);
	// Sensitive URL query params
	const url =
		'https://api.example.com/v1?key=AIzaSecret123&token=superSecret456&other=public';
	const redactedUrl = redactSensitiveText(url);
	assert.doesNotMatch(redactedUrl, /AIzaSecret123/);
	assert.doesNotMatch(redactedUrl, /superSecret456/);
	assert.match(redactedUrl, /other=public/);

	// Basic auth in URL
	const basicUrl = 'https://admin:mySecretPass123@internal.corp.net/data';
	const redactedBasic = redactSensitiveText(basicUrl);
	assert.doesNotMatch(redactedBasic, /mySecretPass123/);

	// Private key block
	const privKey =
		'-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----';
	const redactedKey = redactSensitiveText(privKey);
	assert.doesNotMatch(redactedKey, /MIIEvgIBADANBgkqhkiG9w0BAQEFAASC/);
	assert.match(redactedKey, /\[REDACTED\]/);
});

test('redactSensitiveText: handles non-string and falsy inputs cleanly', () => {
	assert.equal(redactSensitiveText(''), '');
	// @ts-expect-error test non-string runtime inputs
	assert.equal(redactSensitiveText(null), '');
	// @ts-expect-error test non-string runtime inputs
	assert.equal(redactSensitiveText(undefined), '');
	// @ts-expect-error test non-string runtime inputs
	assert.equal(redactSensitiveText(12345), '12345');
});

test('redactSensitiveData: handles circular references and limits depth safely', () => {
	const circular = { name: 'cycle' };
	// @ts-expect-error circular property
	circular.self = circular;

	const sanitized = redactSensitiveData(circular);
	assert.equal(sanitized.name, 'cycle');
	assert.equal(sanitized.self, '[Circular]');
});

test('redactSensitiveData: masks sensitive property keys case-insensitively', () => {
	const data = {
		apiKey: 'super-secret-key-1',
		api_key: 'super-secret-key-2',
		PASSWORD: 'MyPassword123!',
		authToken: 'Bearer eyJ123',
		accessToken: 'token-abc',
		secret: 'my-secret',
		private_key: 'pk_live_123',
		authorization: 'Bearer secretToken',
		user: 'alice',
		publicCount: 42,
	};

	const sanitized = redactSensitiveData(data);
	assert.equal(sanitized.apiKey, '[REDACTED]');
	assert.equal(sanitized.api_key, '[REDACTED]');
	assert.equal(sanitized.PASSWORD, '[REDACTED]');
	assert.equal(sanitized.authToken, '[REDACTED]');
	assert.equal(sanitized.accessToken, '[REDACTED]');
	assert.equal(sanitized.secret, '[REDACTED]');
	assert.equal(sanitized.private_key, '[REDACTED]');
	assert.equal(sanitized.authorization, '[REDACTED]');
	assert.equal(sanitized.user, 'alice');
	assert.equal(sanitized.publicCount, 42);
});

test('redactSensitiveData: respects maxDepth option and avoids unbounded nesting', () => {
	const deep = {
		l1: {
			l2: {
				l3: {
					l4: {
						l5: {
							l6: 'too deep',
						},
					},
				},
			},
		},
	};

	const sanitized = redactSensitiveData(deep, { maxDepth: 3 });
	assert.equal(typeof sanitized.l1.l2.l3, 'string');
	assert.match(sanitized.l1.l2.l3, /\[MaxDepthExceeded\]/);
});

test('redactSensitiveData: truncates long arrays according to maxArrayLength', () => {
	const arr = Array.from({ length: 30 }, (_, i) => `item_${i}`);
	const sanitized = redactSensitiveData(arr, { maxArrayLength: 5 });
	assert.equal(sanitized.length, 6);
	assert.equal(sanitized[0], 'item_0');
	assert.equal(sanitized[4], 'item_4');
	assert.match(String(sanitized[5]), /\[\+25 more items\]/);
});

test('redactSensitiveData: truncates long strings according to maxStringLength', () => {
	const longStr = 'a'.repeat(2500);
	const sanitized = redactSensitiveData(longStr, { maxStringLength: 100 });
	assert.ok(sanitized.length < 200);
	assert.match(sanitized, /\[truncated\]/);
});

test('redactSensitiveData: handles Dates, RegExps, Buffers, and primitives cleanly', () => {
	const now = new Date('2026-11-07T12:00:00.000Z');
	const regex = /test-pattern/i;
	const buf = Buffer.from('hello buffer');

	const sanitized = redactSensitiveData({
		date: now,
		regex,
		buffer: buf,
		num: 123,
		bool: true,
		n: null,
		u: undefined,
	});

	assert.equal(sanitized.date, '2026-11-07T12:00:00.000Z');
	assert.equal(sanitized.regex, '/test-pattern/i');
	assert.match(String(sanitized.buffer), /Buffer/);
	assert.equal(sanitized.num, 123);
	assert.equal(sanitized.bool, true);
	assert.equal(sanitized.n, null);
	assert.equal(sanitized.u, undefined);
});

test('serializeError: extracts name, message, stack, code, and cause chains safely', () => {
	const cause = new Error('Root network socket hangup');
	const top = new Error('Database connection failed', { cause });
	const serialized = serializeError(top);
	assert.equal(serialized.message, 'Database connection failed');
	assert.ok(serialized.stack);
	assert.equal(serialized.cause?.message, 'Root network socket hangup');
});

test('serializeError: handles non-Error objects, strings, and primitives', () => {
	const fromString = serializeError('Something went wrong');
	assert.equal(fromString.name, 'Error');
	assert.equal(fromString.message, 'Something went wrong');

	const fromCustomObj = serializeError({
		message: 'Custom failure',
		code: 'ERR_CUSTOM',
		status: 500,
	});
	assert.equal(fromCustomObj.message, 'Custom failure');
	assert.equal(fromCustomObj.code, 'ERR_CUSTOM');
	assert.equal(fromCustomObj.status, 500);

	const fromNull = serializeError(null);
	assert.equal(fromNull.name, 'Error');
	assert.equal(fromNull.message, 'Unknown error');
});

test('serializeError: handles circular cause chains without infinite loop', () => {
	const errA = new Error('Error A');
	const errB = new Error('Error B');
	// @ts-expect-error cause manipulation
	errA.cause = errB;
	// @ts-expect-error cyclic cause
	errB.cause = errA;

	const serialized = serializeError(errA);
	assert.equal(serialized.message, 'Error A');
	assert.equal(serialized.cause?.message, 'Error B');
	assert.equal(serialized.cause?.cause, '[Circular]');
});

test('serializeError: redacts sensitive credentials in error messages and stacks', () => {
	const rawMsg =
		'Failed to fetch with key AIzaSyD1234567890abcdef and Authorization Bearer eyJsecret';
	const err = new Error(rawMsg);
	const serialized = serializeError(err);
	assert.doesNotMatch(serialized.message, /AIzaSyD1234567890abcdef/);
	assert.doesNotMatch(serialized.message, /eyJsecret/);
	assert.match(serialized.message, /\[REDACTED\]/);
	if (serialized.stack) {
		assert.doesNotMatch(serialized.stack, /AIzaSyD1234567890abcdef/);
	}
});

test('serializeError: serializes AggregateError nested errors array', () => {
	const err1 = new Error('Sub-error 1');
	const err2 = new Error('Sub-error 2');
	const agg = new AggregateError([err1, err2], 'Multiple errors occurred');

	const serialized = serializeError(agg);
	assert.equal(serialized.name, 'AggregateError');
	assert.equal(serialized.message, 'Multiple errors occurred');
	assert.ok(Array.isArray(serialized.errors));
	assert.equal(serialized.errors.length, 2);
	assert.equal(serialized.errors[0]?.message, 'Sub-error 1');
	assert.equal(serialized.errors[1]?.message, 'Sub-error 2');
});

test('redactSensitiveData: preserves Error name, message, and stack without marking non-circular errors as circular', () => {
	const realError = new Error('Database connection timeout');
	const sanitized = redactSensitiveData({ err: realError });
	assert.ok(sanitized.err);
	assert.equal(sanitized.err.name, 'Error');
	assert.equal(sanitized.err.message, 'Database connection timeout');
	assert.ok(sanitized.err.stack);
	assert.notEqual(sanitized.err.message, '[Circular]');
});

test('redactSensitiveText: masks arbitrary key/token assignments in plain text', () => {
	const text1 = 'Config loaded: GEMINI_API_KEY=my_secret_gemini_key_123';
	const text2 = 'Debug log: apiKey: "super-secret-12345"';
	const text3 = 'Auth info: token=bearer_xyz_789 and secret: 999888';
	assert.doesNotMatch(redactSensitiveText(text1), /my_secret_gemini_key_123/);
	assert.match(redactSensitiveText(text1), /GEMINI_API_KEY=\[REDACTED\]/);
	assert.doesNotMatch(redactSensitiveText(text2), /super-secret-12345/);
	assert.doesNotMatch(redactSensitiveText(text3), /bearer_xyz_789/);
});

test('redactSensitiveData: masks headers like Set-Cookie, proxy-authorization, and session IDs', () => {
	const headers = {
		'Set-Cookie': 'session=abc1234; Secure; HttpOnly',
		'proxy-authorization': 'Basic dXNlcjpwYXNz',
		'x-session-id': 'sess_999888',
		'authentication-token': 'auth_111222',
		'content-type': 'application/json',
		author: 'William Shakespeare',
	};

	const sanitized = redactSensitiveData(headers);
	assert.equal(sanitized['Set-Cookie'], '[REDACTED]');
	assert.equal(sanitized['proxy-authorization'], '[REDACTED]');
	assert.equal(sanitized['x-session-id'], '[REDACTED]');
	assert.equal(sanitized['authentication-token'], '[REDACTED]');
	assert.equal(sanitized['content-type'], 'application/json');
	assert.equal(sanitized.author, 'William Shakespeare');
});

test('redactSensitiveData and serializeError: safely handle throwing property getters', () => {
	const evilObj = {
		normal: 'fine',
		get bomb() {
			throw new Error('Explosion');
		},
	};

	const sanitized = redactSensitiveData(evilObj);
	assert.equal(sanitized.normal, 'fine');
	assert.equal(sanitized.bomb, '[Unreadable]');

	const evilErr = new Error('Failure');
	Object.defineProperty(evilErr, 'evilProp', {
		get() {
			throw new Error('Getter failed');
		},
		enumerable: true,
	});

	const serialized = serializeError(evilErr);
	assert.equal(serialized.message, 'Failure');
	assert.equal(serialized.evilProp, '[Unreadable]');
});
