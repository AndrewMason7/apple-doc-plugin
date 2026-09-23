import assert from 'node:assert';
import test from 'node:test';
import Database from 'better-sqlite3';

test('better-sqlite3 FTS5 capability', () => {
  const db = new Database(':memory:');
  db.exec('CREATE VIRTUAL TABLE test_fts USING fts5(title, abstract);');
  db.prepare('INSERT INTO test_fts VALUES (?, ?)').run('NavigationStack', 'A view that displays a root view');
  const rows = db.prepare('SELECT * FROM test_fts WHERE test_fts MATCH ?').all('NavigationStack');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].title, 'NavigationStack');
  db.close();
});
