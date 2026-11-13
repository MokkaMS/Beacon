import assert from 'node:assert/strict';
import test from 'node:test';
import { AppDatabase } from '../src/core/database.js';
import { Logger } from '../src/core/logger.js';

test('AppDatabase initializes core schema, runs versioned migrations once, and stores settings', () => {
  const logger = new Logger(50);
  const db = new AppDatabase(':memory:', logger);

  try {
    db.runMigrations('custom', [
      { version: 1, sql: 'CREATE TABLE test_items (id INTEGER PRIMARY KEY, label TEXT);' },
      { version: 2, sql: 'ALTER TABLE test_items ADD COLUMN count INTEGER DEFAULT 0;' },
    ]);

    // Running again should be idempotent
    db.runMigrations('custom', [
      { version: 1, sql: 'CREATE TABLE test_items (id INTEGER PRIMARY KEY, label TEXT);' },
      { version: 2, sql: 'ALTER TABLE test_items ADD COLUMN count INTEGER DEFAULT 0;' },
    ]);

    db.run('INSERT INTO test_items (label, count) VALUES (?, ?)', 'alpha', 5);
    const row = db.get<{ label: string; count: number }>('SELECT label, count FROM test_items');
    assert.deepEqual({ ...row }, { label: 'alpha', count: 5 });

    db.setSetting('featureFlag', { enabled: true, threshold: 42 });
    assert.deepEqual(db.getSetting('featureFlag', { enabled: false, threshold: 0 }), {
      enabled: true,
      threshold: 42,
    });
  } finally {
    db.close();
  }
});
