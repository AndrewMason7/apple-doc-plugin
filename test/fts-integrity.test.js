import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB, deserializeFloat32Array } from '../dist/server/db/database.js';

test('FTS Integrity: updating a symbol preserves non-empty abstract', () => {
  const db = new AppleDocsDB(':memory:');

  // 1. Initial insert with rich abstract
  db.insertSymbol({
    id: 'documentation/swiftui/griditem',
    framework: 'SwiftUI',
    title: 'GridItem',
    kind: 'struct',
    abstract: 'A description of an item organized within a grid layout.',
    path: '/documentation/swiftui/griditem',
    platforms: ['iOS 14.0+'],
  });

  // 2. Second insert with empty abstract (as occurs in crawler tree walk)
  db.insertSymbol({
    id: 'documentation/swiftui/griditem',
    framework: 'SwiftUI',
    title: 'GridItem',
    kind: 'struct',
    abstract: '',
    path: '/documentation/swiftui/griditem',
    platforms: ['iOS 14.0+'],
  });

  // Abstract must NOT be wiped out
  const sym = db.getSymbolByPath('/documentation/swiftui/griditem');
  assert(sym !== null);
  assert.strictEqual(
    sym.abstract,
    'A description of an item organized within a grid layout.',
    'Non-empty abstract must be preserved on update'
  );

  // Direct FTS MATCH query must succeed without "missing row from content table" error
  const ftsMatch = db.queryFTS('GridItem');
  assert.strictEqual(ftsMatch.length, 1);
  assert.strictEqual(ftsMatch[0].title, 'GridItem');
  assert.strictEqual(
    ftsMatch[0].abstract,
    'A description of an item organized within a grid layout.'
  );

  // rebuildFTS method should rebuild the index cleanly
  assert.doesNotThrow(() => {
    db.rebuildFTS();
  });

  db.close();
});

test('deserializeFloat32Array rejects buffers whose byteLength is not a multiple of 4', () => {
  const corruptBuf = Buffer.from([1, 2, 3]); // byteLength is 3, not divisible by 4
  const result = deserializeFloat32Array(corruptBuf);
  assert.strictEqual(result, null, 'Should return null on invalid byteLength');
});
