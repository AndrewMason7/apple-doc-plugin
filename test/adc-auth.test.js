import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';

test('ADC: API key takes precedence over ADC', async () => {
  const mockAuth = {
    getClient: async () => ({
      getAccessToken: async () => ({ token: 'adc-token-should-not-be-used' }),
    }),
  };

  const search = new GeminiSemanticSearch('my-api-key', 'models/test', 'http://127.0.0.1', mockAuth);
  assert.strictEqual(search.hasApiKey(), true);
  assert.strictEqual(search.hasAuth(), true);

  const headers = await search.getAuthHeaders();
  assert.deepStrictEqual(headers, { 'x-goog-api-key': 'my-api-key' });
});

test('ADC: Uses Bearer token when no API key is provided and ADC is available', async () => {
  let adcCalled = 0;
  const mockAuth = {
    getClient: async () => ({
      getAccessToken: async () => {
        adcCalled++;
        return { token: 'adc-access-token-12345' };
      },
    }),
  };

  const search = new GeminiSemanticSearch(null, 'models/test', 'http://127.0.0.1', mockAuth);
  assert.strictEqual(search.hasApiKey(), false);
  assert.strictEqual(search.hasAuth(), true);

  const headers1 = await search.getAuthHeaders();
  assert.deepStrictEqual(headers1, { Authorization: 'Bearer adc-access-token-12345' });
  assert.strictEqual(adcCalled, 1);

  // Second call should use cached token without re-querying ADC
  const headers2 = await search.getAuthHeaders();
  assert.deepStrictEqual(headers2, { Authorization: 'Bearer adc-access-token-12345' });
  assert.strictEqual(adcCalled, 1, 'Token must be cached');
});

test('ADC: embedQuery sends Authorization Bearer header to endpoint', async () => {
  let receivedAuthHeader = null;

  const server = http.createServer((req, res) => {
    receivedAuthHeader = req.headers['authorization'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ embedding: { values: [0.5, 0.5] } }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const mockAuth = {
    getClient: async () => ({
      getAccessToken: async () => ({ token: 'mock-oauth-bearer-token' }),
    }),
  };

  try {
    const search = new GeminiSemanticSearch(null, 'models/test-model', baseUrl, mockAuth, 2);
    const vec = await search.embedQuery('test adc query');
    assert(vec instanceof Float32Array);
    assert.strictEqual(vec.length, 2);
    assert.strictEqual(receivedAuthHeader, 'Bearer mock-oauth-bearer-token');
  } finally {
    server.close();
  }
});

test('ADC: embedQuery rejects vector when returned dimensions mismatch expectedDimensions', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Returns 4 dimensions when 3072 is expected
    res.end(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3, 0.4] } }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const mockAuth = {
    getClient: async () => ({
      getAccessToken: async () => ({ token: 'mock-token' }),
    }),
  };

  try {
    const search = new GeminiSemanticSearch(null, 'models/test-model', baseUrl, mockAuth, 3072);
    const vec = await search.embedQuery('dimension mismatch query');
    assert.strictEqual(vec, null, 'Should reject mismatched dimensions');
  } finally {
    server.close();
  }
});

test('ADC: returns null when neither API key nor ADC is available', async () => {
  const mockFailingAuth = {
    getClient: async () => {
      throw new Error('Could not load the default credentials');
    },
  };

  const search = new GeminiSemanticSearch(null, 'models/test', 'http://127.0.0.1', mockFailingAuth);
  const headers = await search.getAuthHeaders();
  assert.strictEqual(headers, null);

  const vec = await search.embedQuery('will fail gracefully');
  assert.strictEqual(vec, null);
});
