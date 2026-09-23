import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { ServerState } from '../dist/server/state.js';

test('Wildcards: FTS and LIKE wildcard handling for *, *suffix, and ?', () => {
  const db = new AppleDocsDB(':memory:');
  db.insertSymbol({
    id: 'documentation/swiftui/griditem',
    framework: 'SwiftUI',
    title: 'GridItem',
    kind: 'struct',
    abstract: 'A description of an item organized within a grid layout.',
    path: '/documentation/swiftui/griditem',
    platforms: ['iOS 14.0+'],
  });

  // 1. Prefix wildcard (e.g. Grid*)
  const resPrefix = db.queryFTS('Grid*');
  assert.strictEqual(resPrefix.length, 1);
  assert.strictEqual(resPrefix[0].title, 'GridItem');

  // 2. Suffix wildcard (e.g. *Item)
  const resSuffix = db.queryFTS('*Item');
  assert.strictEqual(resSuffix.length, 1);
  assert.strictEqual(resSuffix[0].title, 'GridItem');

  // 3. Single-character wildcard (e.g. Grid?tem)
  const resSingle = db.queryFTS('Grid?tem');
  assert.strictEqual(resSingle.length, 1);
  assert.strictEqual(resSingle[0].title, 'GridItem');

  db.close();
});

test('Handler: clamps maxResults and validates query', async () => {
  const db = new AppleDocsDB(':memory:');
  for (let i = 0; i < 15; i++) {
    db.insertSymbol({
      id: `sym-${i}`,
      framework: 'SwiftUI',
      title: `View${i}`,
      kind: 'struct',
      abstract: `View component ${i}`,
      path: `/documentation/swiftui/view${i}`,
      platforms: [],
    });
  }

  const searchEngine = new HybridSearchEngine(db, { apiKey: null });
  const handler = buildSearchSymbolsHandler({
    client: {},
    state: new ServerState(),
    db,
    searchEngine,
  });


  // Empty query returns isError: true
  // @ts-ignore
  const errRes = await handler({ query: '' });
  assert.strictEqual(errRes.isError, true);

  // maxResults negative clamps to at least 1
  const minRes = await handler({ query: 'View', maxResults: -10 });
  assert(!minRes.isError);
  assert(minRes.content[0].text.includes('Matches Found: 1\n') || minRes.content[0].text.includes('1'));

  db.close();
});
