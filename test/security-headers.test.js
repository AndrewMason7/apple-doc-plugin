import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';

test('GeminiSemanticSearch configures header-based auth and circuit breaker', async () => {
  const search = new GeminiSemanticSearch('test-key-12345');
  assert.strictEqual(search.hasApiKey(), true);

  // Verify circuit breaker interface
  assert.strictEqual(search.isCircuitOpen(), false);

  // Trip circuit breaker manually for testing
  search.tripCircuitBreaker(10_000);
  assert.strictEqual(search.isCircuitOpen(), true);

  // When circuit breaker is open, embedQuery immediately returns null without network call
  const t0 = performance.now();
  const res = await search.embedQuery('test query');
  const t1 = performance.now();
  assert.strictEqual(res, null);
  assert(t1 - t0 < 10, 'Circuit breaker should fail fast in <10ms');

  search.resetCircuitBreaker();
  assert.strictEqual(search.isCircuitOpen(), false);
});

test('GeminiSemanticSearch sends x-goog-api-key header and strips apiKey from URL', async () => {
  let receivedHeader = null;
  let receivedUrl = null;

  const server = http.createServer((req, res) => {
    receivedHeader = req.headers['x-goog-api-key'];
    receivedUrl = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const search = new GeminiSemanticSearch('my-secret-key-xyz', 'models/test-model', baseUrl);
    const vec = await search.embedQuery('hello world');
    assert(vec instanceof Float32Array);
    assert.strictEqual(vec.length, 3);
    assert.strictEqual(receivedHeader, 'my-secret-key-xyz');
    assert.strictEqual(receivedUrl, '/models/test-model:embedContent');
    assert(!receivedUrl.includes('key='), 'URL must not contain API key');
  } finally {
    server.close();
  }
});

test('GeminiSemanticSearch trips circuit breaker automatically on 429 response', async () => {
  let hitCount = 0;
  const server = http.createServer((req, res) => {
    hitCount++;
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Resource exhausted' } }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const search = new GeminiSemanticSearch('key', 'models/test-model', baseUrl);
    assert.strictEqual(search.isCircuitOpen(), false);

    const res1 = await search.embedQuery('fail query');
    assert.strictEqual(res1, null);
    assert.strictEqual(hitCount, 1);
    assert.strictEqual(search.isCircuitOpen(), true, 'Circuit breaker should be open after 429');

    // Second call should fail fast without hitting server
    const res2 = await search.embedQuery('fail query 2');
    assert.strictEqual(res2, null);
    assert.strictEqual(hitCount, 1, 'Server should not be hit when circuit is open');
  } finally {
    server.close();
  }
});

test('GeminiSemanticSearch sends output_dimensionality: 3072 in payload', async () => {
  let receivedBody = null;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      receivedBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ embedding: { values: [0.1, 0.2] } }));
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const search = new GeminiSemanticSearch('key', 'models/test-model', baseUrl);
    await search.embedQuery('test dimensionality');
    assert(receivedBody !== null);
    assert.strictEqual(receivedBody.outputDimensionality, 3072, 'Must request 3072 dimensions explicitly');
  } finally {
    server.close();
  }
});

test('GeminiSemanticSearch trips circuit breaker on 401 and 403 status codes', async () => {
  for (const status of [401, 403]) {
    const server = http.createServer((req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized / Forbidden' } }));
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const search = new GeminiSemanticSearch('bad-key', 'models/test-model', baseUrl);
      assert.strictEqual(search.isCircuitOpen(), false);
      const res = await search.embedQuery('fail query');
      assert.strictEqual(res, null);
      assert.strictEqual(search.isCircuitOpen(), true, `Circuit breaker should trip on status ${status}`);
    } finally {
      server.close();
    }
  }
});

