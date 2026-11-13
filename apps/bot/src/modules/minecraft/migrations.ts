import type { ModuleMigration } from '../../core/types.js';

export const minecraftMigrations: ModuleMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS mc_servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 25565,
        edition TEXT NOT NULL DEFAULT 'java',
        poll_interval_sec INTEGER NOT NULL DEFAULT 60,
        enabled INTEGER NOT NULL DEFAULT 1,
        guild_id TEXT,
        alert_channel_id TEXT,
        status_channel_id TEXT,
        status_message_id TEXT,
        notify_offline INTEGER NOT NULL DEFAULT 1,
        notify_players INTEGER NOT NULL DEFAULT 0,
        rcon_port INTEGER,
        rcon_password TEXT,
        last_online INTEGER,
        last_checked_at TEXT,
        last_latency_ms INTEGER,
        last_player_count INTEGER NOT NULL DEFAULT 0,
        last_max_players INTEGER NOT NULL DEFAULT 0,
        last_version TEXT,
        last_motd TEXT,
        last_favicon TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS mc_server_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL REFERENCES mc_servers(id) ON DELETE CASCADE,
        checked_at TEXT NOT NULL DEFAULT (datetime('now')),
        online INTEGER NOT NULL,
        latency_ms INTEGER,
        player_count INTEGER NOT NULL DEFAULT 0,
        max_players INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_mc_checks_server_time
        ON mc_server_checks(server_id, checked_at DESC);

      CREATE TABLE IF NOT EXISTS mc_players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        uuid TEXT,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        total_playtime_seconds INTEGER NOT NULL DEFAULT 0,
        session_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS mc_player_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL REFERENCES mc_servers(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES mc_players(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        left_at TEXT,
        duration_seconds INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_mc_sessions_active
        ON mc_player_sessions(server_id, left_at);
      CREATE INDEX IF NOT EXISTS idx_mc_sessions_player
        ON mc_player_sessions(player_id, joined_at DESC);
    `,
  },
];
