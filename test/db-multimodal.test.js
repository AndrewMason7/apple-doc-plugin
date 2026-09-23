import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';

test('AppleDocsDB stores and retrieves semantic items with media_url and media_type', () => {
  const db = new AppleDocsDB(':memory:');
  const vec = new Float32Array(3072);
  vec[0] = 0.85;

  db.insertSemanticItem({
    id: 'preview-nav-split',
    framework: 'SwiftUI',
    title: 'NavigationSplitView Layout Preview',
    kind: 'ui_preview',
    summary: 'Three-column navigation layout on iPad.',
    path: '/documentation/swiftui/navigationsplitview',
    mediaUrl: 'https://developer.apple.com/tutorials/images/nav-split.png',
    mediaType: 'image/png',
    embedding: vec,
  });

  const items = db.getSemanticItems('SwiftUI');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].mediaUrl, 'https://developer.apple.com/tutorials/images/nav-split.png');
  assert.strictEqual(items[0].mediaType, 'image/png');
  assert(Math.abs(items[0].embedding[0] - 0.85) < 0.0001);

  db.close();
});
