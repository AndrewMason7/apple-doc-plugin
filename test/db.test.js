import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';

test('AppleDocsDB initializes schema and inserts/queries symbols', () => {
  const db = new AppleDocsDB(':memory:');
  db.insertSymbol({
    id: 'documentation/swiftui/navigationstack',
    framework: 'SwiftUI',
    title: 'NavigationStack',
    kind: 'struct',
    abstract: 'A view that displays a root view and enables navigation.',
    path: '/documentation/swiftui/navigationstack',
    platforms: ['iOS 16.0+', 'macOS 13.0+'],
    isPrimaryType: true,
  });

  const results = db.queryFTS('NavigationStack');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].title, 'NavigationStack');
  assert.strictEqual(results[0].framework, 'SwiftUI');
  assert.deepStrictEqual(results[0].platforms, ['iOS 16.0+', 'macOS 13.0+']);

  const frameworks = db.getFrameworks();
  assert.deepStrictEqual(frameworks, ['SwiftUI']);

  db.close();
});
