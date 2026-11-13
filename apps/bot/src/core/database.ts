import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Logger } from './logger.js';

const CORE_MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS _migrations (
        namespace TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (namespace, version)
      );

      CREATE TABLE IF NOT EXISTS modules_state (
        module_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        guild_name TEXT NOT NULL DEFAULT '',
        log_channel_id TEXT,
        disabled_modules TEXT NOT NULL DEFAULT '[]',
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL DEFAULT '*',
        user_id TEXT NOT NULL,
        username_cache TEXT NOT NULL DEFAULT '',
        permissions_json TEXT NOT NULL DEFAULT '[]',
        is_admin INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        role_name_cache TEXT NOT NULL DEFAULT '',
        permissions_json TEXT NOT NULL DEFAULT '[]',
        is_admin INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(guild_id, role_id)
      );

      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'web',
        guild_id TEXT,
        action TEXT NOT NULL,
        target TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
      CREATE INDEX IF NOT EXISTS idx_role_permissions_guild_id ON role_permissions(guild_id);
    `,
  },
];

export class AppDatabase {
  public readonly raw: DatabaseSync;
  private readonly logger: Logger;

  constructor(dbPath: string, logger: Logger) {
    this.logger = logger;
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.raw = new DatabaseSync(dbPath);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    this.runMigrations('core', CORE_MIGRATIONS);
  }

  runMigrations(
    namespace: string,
    migrations: { version: number; sql: string }[],
  ): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        namespace TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (namespace, version)
      );
    `);

    const appliedRows = this.raw
      .prepare('SELECT version FROM _migrations WHERE namespace = ?')
      .all(namespace) as { version: number }[];
    const applied = new Set(appliedRows.map((r) => r.version));

    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    for (const migration of sorted) {
      if (applied.has(migration.version)) continue;
      this.transaction(() => {
        this.raw.exec(migration.sql);
        this.raw
          .prepare('INSERT INTO _migrations (namespace, version) VALUES (?, ?)')
          .run(namespace, migration.version);
      });
      this.logger.info('db', `Applied migration ${namespace} v${migration.version}`);
    }
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.raw.prepare(sql).run(...params);
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.get<{ value_json: string }>(
      'SELECT value_json FROM bot_settings WHERE key = ?',
      key,
    );
    if (!row) return fallback;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return fallback;
    }
  }

  setSetting<T>(key: string, value: T): void {
    this.run(
      `INSERT INTO bot_settings (key, value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`,
      key,
      JSON.stringify(value),
    );
  }

  close(): void {
    this.raw.close();
  }
}
