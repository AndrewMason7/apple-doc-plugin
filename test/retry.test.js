import assert from 'node:assert';
import test from 'node:test';

import { withRetry } from '../dist/server/services/search/retry.js';

const noSleep = async () => {};

test('withRetry returns the first successful result without retrying', async () => {
	let calls = 0;
	const delays = [];

	const result = await withRetry(
		async () => {
			calls++;
			return 'ok';
		},
		{
			attempts: 4,
			baseDelayMs: 100,
			sleep: async (ms) => delays.push(ms),
		},
	);

	assert.strictEqual(result, 'ok');
	assert.strictEqual(calls, 1);
	assert.deepStrictEqual(delays, [], 'no backoff after a first-try success');
});

test('withRetry retries with exponential backoff and returns the eventual success', async () => {
	let calls = 0;
	const delays = [];

	const result = await withRetry(
		async () => {
			calls++;
			if (calls < 3) throw new Error(`fail ${calls}`);
			return 'third time';
		},
		{
			attempts: 5,
			baseDelayMs: 100,
			sleep: async (ms) => delays.push(ms),
		},
	);

	assert.strictEqual(result, 'third time');
	assert.strictEqual(calls, 3);
	assert.deepStrictEqual(
		delays,
		[100, 200],
		'backoff doubles between attempts',
	);
});

test('withRetry gives up after the attempt budget and reports the last error', async () => {
	let calls = 0;

	await assert.rejects(
		() =>
			withRetry(
				async () => {
					calls++;
					throw new Error('always fails');
				},
				{ attempts: 3, baseDelayMs: 50, sleep: noSleep },
			),
		/always fails/,
	);

	assert.strictEqual(calls, 3, 'must not exceed the attempt budget');
});

test('withRetry honours shouldRetry so permanent errors fail immediately', async () => {
	let calls = 0;
	const permanent = Object.assign(new Error('bad request'), {
		permanent: true,
	});

	await assert.rejects(
		() =>
			withRetry(
				async () => {
					calls++;
					throw permanent;
				},
				{
					attempts: 5,
					baseDelayMs: 10,
					sleep: noSleep,
					shouldRetry: (err) => !err.permanent,
				},
			),
		/bad request/,
	);

	assert.strictEqual(calls, 1, 'a permanent error must not be retried');
});
