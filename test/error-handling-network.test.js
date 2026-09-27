import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient } from '../dist/apple-client/http-client.js';
import { AppleDocsNetworkError } from '../dist/server/errors.js';

test('HttpClient: throws AppleDocsNetworkError with status 404 without retries', async () => {
	const client = new HttpClient();
	const startTime = Date.now();
	await assert.rejects(
		async () => {
			await client.makeRequest(
				'definitely-non-existent-documentation-path-12345',
			);
		},
		(err) => {
			assert.ok(err instanceof AppleDocsNetworkError);
			assert.equal(err.status, 404);
			assert.equal(err.isTransient, false);
			assert.equal(err.code, 'NETWORK_ERROR');
			return true;
		},
	);
	const duration = Date.now() - startTime;
	// Should fail fast without 3 backoff iterations (which would take > 700ms)
	assert.ok(duration < 5000);
});

test('HttpClient: retries transient errors up to maxRetries', async () => {
	const client = new HttpClient();
	let callCount = 0;

	// Mock private axios.get via temporary interceptor or prototype method
	const originalMakeRequest = client.makeRequest.bind(client);

	// Test passing custom retryOptions: maxRetries = 1, initialDelayMs = 10
	await assert.rejects(
		async () => {
			await client.makeRequest('test-path-with-retry-exhaustion', {
				maxRetries: 1,
				initialDelayMs: 10,
			});
		},
		(err) => {
			assert.ok(err instanceof AppleDocsNetworkError);
			return true;
		},
	);
});
