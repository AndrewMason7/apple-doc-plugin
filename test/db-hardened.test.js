import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB, deserializeFloat32Array } from '../dist/server/db/database.js';

test('deserializeFloat32Array handles unaligned buffer offsets safely', () => {
  // Create an unaligned buffer where byteOffset is not a multiple of 4
  const source = new Float32Array([1.5, 2.5, 3.5, 4.5]);
  const rawBytes = Buffer.alloc(32);
  // Write float values at odd offset (e.g. byte offset 3)
  const oddOffset = 3;
  Buffer.from(source.buffer).copy(rawBytes, oddOffset);
  const unalignedSubarray = rawBytes.subarray(oddOffset, oddOffset + source.byteLength);

  assert.strictEqual(unalignedSubarray.byteOffset % 4, 3, 'Must be unaligned offset');

  // Direct Float32Array constructor would throw RangeError:
  assert.throws(() => {
    new Float32Array(unalignedSubarray.buffer, unalignedSubarray.byteOffset, source.length);
  }, /start offset/);

  // deserializeFloat32Array safely recovers the array
  const recovered = deserializeFloat32Array(unalignedSubarray);
  assert.strictEqual(recovered.length, 4);
  assert.strictEqual(recovered[0], 1.5);
  assert.strictEqual(recovered[1], 2.5);
  assert.strictEqual(recovered[2], 3.5);
  assert.strictEqual(recovered[3], 4.5);
});

test('AppleDocsDB caches semantic items in memory with precomputed L2 norm', () => {
  const db = new AppleDocsDB(':memory:');
  const vec = new Float32Array([3.0, 4.0]); // L2 norm is 5.0
  db.insertSemanticItem({
    id: 'test-1',
    framework: 'SwiftUI',
    title: 'Text',
    kind: 'struct',
    summary: 'A view that displays text.',
    path: '/documentation/swiftui/text',
    embedding: vec,
  });

  const items1 = db.getSemanticItems();
  assert.strictEqual(items1.length, 1);
  assert.strictEqual(items1[0].norm, 5.0);

  // In-memory cache should return the cached list without re-querying disk
  const items2 = db.getSemanticItems();
  assert.strictEqual(items1, items2, 'Should return cached instance');

  // Inserting a new item invalidates the cache
  db.insertSemanticItem({
    id: 'test-2',
    framework: 'SwiftUI',
    title: 'Button',
    kind: 'struct',
    summary: 'A control that initiates an action.',
    path: '/documentation/swiftui/button',
    embedding: new Float32Array([1.0, 0.0]),
  });

  const items3 = db.getSemanticItems();
  assert.notStrictEqual(items1, items3, 'Cache should be invalidated after insert');
  assert.strictEqual(items3.length, 2);
  db.close();
});

test('AppleDocsDB queryFTS sanitizes complex syntax characters without crashing', () => {
  const db = new AppleDocsDB(':memory:');
  db.insertSymbol({
    id: 'swiftui-view',
    framework: 'SwiftUI',
    title: 'View',
    kind: 'protocol',
    abstract: 'A type that represents part of the user interface.',
    path: '/documentation/swiftui/view',
    platforms: ['iOS', 'macOS'],
  });

  // Queries with syntax characters that would break un-sanitized FTS5
  const res1 = db.queryFTS('View (SwiftUI) : * ^');
  assert(Array.isArray(res1));
  assert(res1.length > 0);
  assert.strictEqual(res1[0].title, 'View');

  // Query with pure punctuation returns empty array cleanly
  const res2 = db.queryFTS('::: *** ()');
  assert.deepStrictEqual(res2, []);

  // Safe against LIKE wildcards
  const res3 = db.queryFTS('%_test_%');
  assert(Array.isArray(res3));

  db.close();
});

test('AppleDocsDB safely handles corrupted platform JSON without crashing', () => {
  const db = new AppleDocsDB(':memory:');
  db.insertSymbol({
    id: 'corrupted-sym',
    framework: 'SwiftUI',
    title: 'Corrupted',
    kind: 'class',
    abstract: 'Corrupted item',
    path: '/documentation/swiftui/corrupted',
    platforms: ['iOS'],
  });

  // Corrupt the JSON platforms directly in SQLite
  // @ts-ignore
  db['db'].prepare("UPDATE symbols SET platforms = '{malformed json' WHERE id = 'corrupted-sym'").run();

  const sym = db.getSymbolByPath('/documentation/swiftui/corrupted');
  assert(sym !== null);
  assert.deepStrictEqual(sym.platforms, []);

  const fts = db.queryFTS('Corrupted');
  assert(fts.length > 0);
  assert.deepStrictEqual(fts[0].platforms, []);

  db.close();
});
