import assert from 'node:assert';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { HybridSearchEngine } from '../dist/server/services/search/hybrid-search.js';
import { buildSearchSymbolsHandler } from '../dist/server/handlers/search-symbols.js';
import { buildGetDocumentationHandler } from '../dist/server/handlers/get-documentation.js';
import { ServerState } from '../dist/server/state.js';
import { AppleDevDocsClient } from '../dist/apple-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('End-to-End: Global search on seeded 100k+ SQLite database', async () => {
  const dbPath = join(__dirname, '../data/apple-docs.db');
  const db = new AppleDocsDB(dbPath, { readonly: true });
  const searchEngine = new HybridSearchEngine(db);
  const client = new AppleDevDocsClient();
  const state = new ServerState();

  const searchHandler = buildSearchSymbolsHandler({
    client,
    state,
    db,
    searchEngine,
  });

  // 1. Global search without choosing technology
  const t0 = performance.now();
  const resGlobal = await searchHandler({ query: 'NavigationSplitView' });
  const t1 = performance.now();
  const textGlobal = resGlobal.content[0].text;

  console.log(`Global search took ${(t1 - t0).toFixed(2)}ms`);
  assert(textGlobal.includes('NavigationSplitView'), 'Expected NavigationSplitView in results');
  assert(textGlobal.includes('SwiftUI'), 'Expected SwiftUI framework tag');

  // 2. Scoped search via framework param
  const resUIKit = await searchHandler({ query: 'ViewController', framework: 'UIKit' });
  const textUIKit = resUIKit.content[0].text;
  assert(textUIKit.includes('UIViewController'), 'Expected UIViewController in UIKit results');
  assert(textUIKit.includes('UIKit'), 'Expected UIKit framework tag');

  // 3. Get documentation for symbol
  const getDocHandler = buildGetDocumentationHandler({ client, state });
  const docRes = await getDocHandler({ path: 'documentation/swiftui/navigationsplitview' });
  const docText = docRes.content[0].text;
  assert(docText.includes('NavigationSplitView') || docText.includes('SwiftUI'), 'Expected doc content');

  db.close();
});
