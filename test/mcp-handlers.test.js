import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { ServerState } from '../dist/server/state.js';
import { AppleDevDocsClient } from '../dist/apple-client.js';

test('search_symbols succeeds globally when no technology is selected', async () => {
  const db = new AppleDocsDB(':memory:');
  db.insertSymbol({
    id: 'documentation/swiftui/view',
    framework: 'SwiftUI',
    title: 'View',
    kind: 'protocol',
    abstract: 'A type that represents part of the user interface.',
    path: '/documentation/swiftui/view',
    platforms: ['iOS 13.0+'],
    isPrimaryType: true,
  });

  const state = new ServerState();
  const searchEngine = new HybridSearchEngine(db, { apiKey: null });
  const client = new AppleDevDocsClient();

  const handler = buildSearchSymbolsHandler({
    client,
    state,
    db,
    searchEngine,
  });

  const response = await handler({ query: 'View' });
  const text = response.content[0].text;
  assert(text.includes('View'));
  assert(text.includes('SwiftUI'));
  assert(!text.includes('No technology selected'));
  db.close();
});

test('search_symbols respects framework argument', async () => {
  const db = new AppleDocsDB(':memory:');
  db.insertSymbol({
    id: 'documentation/swiftui/color',
    framework: 'SwiftUI',
    title: 'Color',
    kind: 'struct',
    abstract: 'A representation of a color in SwiftUI.',
    path: '/documentation/swiftui/color',
    platforms: ['iOS 13.0+'],
    isPrimaryType: true,
  });
  db.insertSymbol({
    id: 'documentation/uikit/uicolor',
    framework: 'UIKit',
    title: 'UIColor',
    kind: 'class',
    abstract: 'An object that stores color data.',
    path: '/documentation/uikit/uicolor',
    platforms: ['iOS 2.0+'],
    isPrimaryType: true,
  });

  const state = new ServerState();
  const searchEngine = new HybridSearchEngine(db, { apiKey: null });
  const client = new AppleDevDocsClient();

  const handler = buildSearchSymbolsHandler({
    client,
    state,
    db,
    searchEngine,
  });

  const response = await handler({ query: 'Color', framework: 'SwiftUI' });
  const text = response.content[0].text;
  assert(text.includes('SwiftUI'));
  assert(!text.includes('UIKit'));
  db.close();
});
