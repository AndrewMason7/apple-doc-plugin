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

test('Wildcards: Suffix wildcard prioritizes primary types and shorter titles under limit', () => {
  const db = new AppleDocsDB(':memory:');
  
  // Insert a sprawling internal type first (which would be visited first without ORDER BY)
  db.insertSymbol({
    id: 'sym-internal-long',
    framework: 'SwiftUI',
    title: '_InternalSprawlingPrimitiveButtonStyleConfigurationLabelWrapper',
    kind: 'struct',
    abstract: 'Internal wrapper',
    path: '/doc/internal',
    platforms: ['iOS'],
    isPrimaryType: false,
  });

  // Insert concise primary types later in the table
  db.insertSymbol({
    id: 'sym-button-style',
    framework: 'SwiftUI',
    title: 'ButtonStyle',
    kind: 'protocol',
    abstract: 'A type that applies standard interaction behavior and a custom appearance to all buttons.',
    path: '/documentation/swiftui/buttonstyle',
    platforms: ['iOS', 'macOS'],
    isPrimaryType: true,
  });

  db.insertSymbol({
    id: 'sym-list-style',
    framework: 'SwiftUI',
    title: 'ListStyle',
    kind: 'protocol',
    abstract: 'A specification for the appearance and interaction of a list.',
    path: '/documentation/swiftui/liststyle',
    platforms: ['iOS', 'macOS'],
    isPrimaryType: true,
  });

  // Query with limit 2 - should return ListStyle and ButtonStyle, excluding the long internal type
  const res = db.queryFTS('*Style', undefined, 2);
  assert.strictEqual(res.length, 2);
  const titles = res.map((r) => r.title);
  assert(titles.includes('ButtonStyle'), 'ButtonStyle must be included in top results');
  assert(titles.includes('ListStyle'), 'ListStyle must be included in top results');
  assert(!titles.includes('_InternalSprawlingPrimitiveButtonStyleConfigurationLabelWrapper'), 'Long internal type must be ranked out');

  db.close();
});

test('Handler: clamps maxResults (including NaN and negatives) and validates query', async () => {
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

  // 1. Empty query returns isError: true
  // @ts-ignore
  const errRes = await handler({ query: '' });
  assert.strictEqual(errRes.isError, true);

  // 2. Whitespace query returns isError: true
  const wsRes = await handler({ query: '   ' });
  assert.strictEqual(wsRes.isError, true);

  // 3. maxResults negative clamps strictly to 1
  const minRes = await handler({ query: 'View', maxResults: -10 });
  assert(!minRes.isError);
  assert(minRes.content[0].text.includes('**Matches Found:** 1\n'), 'Negative maxResults must clamp to exactly 1');

  // 4. maxResults NaN defaults gracefully without SQL error
  const nanRes = await handler({ query: 'View', maxResults: NaN });
  assert(!nanRes.isError);
  assert(nanRes.content[0].text.includes('**Matches Found:** 15\n'));

  db.close();
});
