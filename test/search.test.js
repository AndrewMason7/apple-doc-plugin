import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';

test('HybridSearchEngine returns scored results without Gemini key', async () => {
  const db = new AppleDocsDB(':memory:');
  db.insertSymbol({
    id: 'documentation/swiftui/navigationstack',
    framework: 'SwiftUI',
    title: 'NavigationStack',
    kind: 'struct',
    abstract: 'A view that displays a root view.',
    path: '/documentation/swiftui/navigationstack',
    platforms: ['iOS 16.0+'],
    isPrimaryType: true,
  });
  db.insertSymbol({
    id: 'documentation/swiftui/navigationpath',
    framework: 'SwiftUI',
    title: 'NavigationPath',
    kind: 'struct',
    abstract: 'A type-erased list of data representing the navigation stack.',
    path: '/documentation/swiftui/navigationpath',
    platforms: ['iOS 16.0+'],
    isPrimaryType: true,
  });

  const engine = new HybridSearchEngine(db, { apiKey: null });
  const results = await engine.search('NavigationStack');

  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].title, 'NavigationStack'); // Exact match boosted
  assert(results[0].score > results[1].score);
  db.close();
});

test('GeminiSemanticSearch computes cosine similarity correctly', () => {
  const semantic = new GeminiSemanticSearch();
  const v1 = new Float32Array([1, 0, 0]);
  const v2 = new Float32Array([1, 0, 0]);
  const v3 = new Float32Array([0, 1, 0]);

  assert.strictEqual(semantic.cosineSimilarity(v1, v2), 1.0);
  assert.strictEqual(semantic.cosineSimilarity(v1, v3), 0.0);
});

test('HybridSearchEngine performs semantic vector match if items exist in DB', async () => {
  const db = new AppleDocsDB(':memory:');
  db.insertSymbol({
    id: 'documentation/corelocation/cllocationmanager',
    framework: 'CoreLocation',
    title: 'CLLocationManager',
    kind: 'class',
    abstract: 'The object that you use to start and stop the delivery of location-related events.',
    path: '/documentation/corelocation/cllocationmanager',
    platforms: ['iOS 2.0+'],
    isPrimaryType: true,
  });

  // Insert mock semantic item
  const mockEmbedding = new Float32Array(768);
  mockEmbedding[0] = 1.0;
  db.insertSemanticItem({
    id: 'guide-location',
    framework: 'CoreLocation',
    title: 'Tracking User Location in the Background',
    kind: 'guide',
    summary: 'Configure background location updates and request appropriate permissions.',
    path: '/documentation/corelocation/tracking_location',
    embedding: mockEmbedding,
  });

  const engine = new HybridSearchEngine(db);
  // Inject mock query embedding
  const queryVec = new Float32Array(768);
  queryVec[0] = 0.99;
  const semanticMatches = engine.searchSemanticWithVector(queryVec);

  assert.strictEqual(semanticMatches.length, 1);
  assert.strictEqual(semanticMatches[0].title, 'Tracking User Location in the Background');
  assert(semanticMatches[0].similarity > 0.9);

  db.close();
});
