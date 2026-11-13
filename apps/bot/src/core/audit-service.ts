import type { AppDatabase } from './database.js';

export interface AuditEntryInput {
  actorId: string;
  actorName: string;
  source: 'web' | 'discord' | 'system';
  guildId?: string | null;
  action: string;
  target?: string | null;
  details?: Record<string, unknown>;
}

export interface AuditLogRow {
  id: number;
  actor_id: string;
  actor_name: string;
  source: string;
  guild_id: string | null;
  action: string;
  target: string | null;
  details_json: string;
  created_at: string;
}

export class AuditService {
  constructor(private readonly db: AppDatabase) {}

  record(entry: AuditEntryInput): void {
    this.db.run(
      `INSERT INTO audit_logs (actor_id, actor_name, source, guild_id, action, target, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      entry.actorId,
      entry.actorName,
      entry.source,
      entry.guildId ?? null,
      entry.action,
      entry.target ?? null,
      JSON.stringify(entry.details ?? {}),
    );
  }

  listRecent(options: { limit?: number; guildId?: string } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const rows = options.guildId
      ? this.db.all<AuditLogRow>(
          `SELECT * FROM audit_logs WHERE guild_id = ? ORDER BY id DESC LIMIT ?`,
          options.guildId,
          limit,
        )
      : this.db.all<AuditLogRow>(
          `SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?`,
          limit,
        );

    return rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      source: row.source,
      guildId: row.guild_id,
      action: row.action,
      target: row.target,
      details: safeJsonParse(row.details_json, {}),
      createdAt: row.created_at,
    }));
  }
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
