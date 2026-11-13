import { EmbedBuilder } from 'discord.js';
import { RCON, status, statusBedrock } from 'minecraft-server-util';
import type { ModuleContext } from '../../core/types.js';

export interface McServerRow {
  id: number;
  name: string;
  host: string;
  port: number;
  edition: 'java' | 'bedrock';
  poll_interval_sec: number;
  enabled: number;
  guild_id: string | null;
  alert_channel_id: string | null;
  status_channel_id: string | null;
  status_message_id: string | null;
  notify_offline: number;
  notify_players: number;
  rcon_port: number | null;
  rcon_password: string | null;
  last_online: number | null;
  last_checked_at: string | null;
  last_latency_ms: number | null;
  last_player_count: number;
  last_max_players: number;
  last_version: string | null;
  last_motd: string | null;
  last_favicon: string | null;
  created_at: string;
}

export interface McPingPlayer {
  name: string;
  id?: string;
}

export interface McPingResult {
  online: boolean;
  latencyMs: number | null;
  playerCount: number;
  maxPlayers: number;
  players: McPingPlayer[];
  version: string | null;
  motd: string | null;
  favicon: string | null;
  errorMessage?: string;
}

export type McPingFn = (server: McServerRow) => Promise<McPingResult>;

export function sanitizeMcServer(row: McServerRow) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    edition: row.edition,
    pollIntervalSec: row.poll_interval_sec,
    enabled: row.enabled === 1,
    guildId: row.guild_id,
    alertChannelId: row.alert_channel_id,
    statusChannelId: row.status_channel_id,
    statusMessageId: row.status_message_id,
    notifyOffline: row.notify_offline === 1,
    notifyPlayers: row.notify_players === 1,
    rconConfigured: Boolean(row.rcon_port && row.rcon_password),
    rconPort: row.rcon_port,
    lastOnline: row.last_online === null ? null : row.last_online === 1,
    lastCheckedAt: row.last_checked_at,
    lastLatencyMs: row.last_latency_ms,
    lastPlayerCount: row.last_player_count,
    lastMaxPlayers: row.last_max_players,
    lastVersion: row.last_version,
    lastMotd: row.last_motd,
    lastFavicon: row.last_favicon,
    createdAt: row.created_at,
  };
}

export async function defaultPingServer(server: McServerRow): Promise<McPingResult> {
  try {
    if (server.edition === 'bedrock') {
      const start = Date.now();
      const res = await statusBedrock(server.host, server.port, { timeout: 6000 });
      const latencyMs = Date.now() - start;
      return {
        online: true,
        latencyMs,
        playerCount: res.players.online,
        maxPlayers: res.players.max,
        players: [],
        version: res.version.name || 'Bedrock',
        motd: res.motd.clean || null,
        favicon: null,
      };
    }

    const res = await status(server.host, server.port, { timeout: 6000 });
    return {
      online: true,
      latencyMs: Math.round(res.roundTripLatency),
      playerCount: res.players.online,
      maxPlayers: res.players.max,
      players: (res.players.sample ?? []).map((p) => ({ name: p.name, id: p.id })),
      version: res.version.name || 'Java',
      motd: res.motd.clean || null,
      favicon: res.favicon || null,
    };
  } catch (err) {
    return {
      online: false,
      latencyMs: null,
      playerCount: 0,
      maxPlayers: 0,
      players: [],
      version: null,
      motd: null,
      favicon: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export class MinecraftMonitorService {
  private bootTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly nextCheckDue = new Map<number, number>();
  private readonly inFlight = new Set<number>();
  private readonly pingFn: McPingFn;

  constructor(
    private readonly ctx: ModuleContext,
    pingFn?: McPingFn,
  ) {
    this.pingFn = pingFn ?? defaultPingServer;
  }

  start(): void {
    if (this.tickTimer) return;
    this.stopped = false;
    this.ctx.logger.info('module:minecraft', 'Starting 24/7 Minecraft server monitor');

    // Run initial poll shortly after boot
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      if (!this.stopped) void this.tick(true);
    }, 1500);

    this.tickTimer = setInterval(() => {
      if (!this.stopped) void this.tick(false);
    }, 5000);

    this.pruneTimer = setInterval(() => {
      if (!this.stopped) this.pruneOldChecks();
    }, 60 * 60 * 1000);
  }

  stop(): void {
    this.stopped = true;
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  private async tick(forceAll: boolean): Promise<void> {
    const servers = this.ctx.db.all<McServerRow>(
      'SELECT * FROM mc_servers WHERE enabled = 1',
    );
    const now = Date.now();

    for (const server of servers) {
      if (this.inFlight.has(server.id)) continue;
      const due = this.nextCheckDue.get(server.id) ?? 0;
      if (!forceAll && now < due) continue;

      this.nextCheckDue.set(server.id, now + server.poll_interval_sec * 1000);
      this.inFlight.add(server.id);

      void this.pollServer(server.id).finally(() => {
        this.inFlight.delete(server.id);
      });
    }
  }

  async pollServer(serverId: number): Promise<{
    server: ReturnType<typeof sanitizeMcServer>;
    result: McPingResult;
    joined: string[];
    left: string[];
  } | null> {
    if (this.stopped) return null;
    const server = this.ctx.db.get<McServerRow>(
      'SELECT * FROM mc_servers WHERE id = ?',
      serverId,
    );
    if (!server) return null;

    const result = await this.pingFn(server);
    if (this.stopped) return null;
    const outcome = this.processCheckResult(server, result);

    await this.dispatchNotifications(server, result, outcome).catch((err) => {
      this.ctx.logger.warn('module:minecraft', 'Failed to send Discord notification', {
        serverId: server.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    const refreshed = this.ctx.db.get<McServerRow>(
      'SELECT * FROM mc_servers WHERE id = ?',
      serverId,
    )!;

    return {
      server: sanitizeMcServer(refreshed),
      result,
      joined: outcome.joined,
      left: outcome.left,
    };
  }

  /**
   * Pure DB state update for a server check (used by pollServer and unit tests).
   */
  processCheckResult(
    server: McServerRow,
    result: McPingResult,
    nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19),
  ): {
    statusChanged: boolean;
    wasOnline: boolean | null;
    joined: string[];
    left: string[];
  } {
    const wasOnline = server.last_online === null ? null : server.last_online === 1;
    const statusChanged = wasOnline !== null && wasOnline !== result.online;

    const joined: string[] = [];
    const left: string[] = [];

    this.ctx.db.transaction(() => {
      this.ctx.db.run(
        `INSERT INTO mc_server_checks
          (server_id, checked_at, online, latency_ms, player_count, max_players, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        server.id,
        nowIso,
        result.online ? 1 : 0,
        result.latencyMs,
        result.playerCount,
        result.maxPlayers,
        result.errorMessage ?? null,
      );

      this.ctx.db.run(
        `UPDATE mc_servers SET
           last_online = ?,
           last_checked_at = ?,
           last_latency_ms = ?,
           last_player_count = ?,
           last_max_players = ?,
           last_version = COALESCE(?, last_version),
           last_motd = COALESCE(?, last_motd),
           last_favicon = COALESCE(?, last_favicon)
         WHERE id = ?`,
        result.online ? 1 : 0,
        nowIso,
        result.latencyMs,
        result.playerCount,
        result.maxPlayers,
        result.version,
        result.motd,
        result.favicon,
        server.id,
      );

      // Reconcile player sessions
      const activeSessions = this.ctx.db.all<{
        id: number;
        player_id: number;
        username: string;
        joined_at: string;
      }>(
        'SELECT id, player_id, username, joined_at FROM mc_player_sessions WHERE server_id = ? AND left_at IS NULL',
        server.id,
      );

      const seenMap = new Map<string, McPingPlayer>();
      if (result.online) {
        for (const p of result.players) {
          if (!p.name || p.name === 'Anonymous Player') continue;
          seenMap.set(p.name, p);
        }
      }

      // Note: if playerCount > 0 and players sample is empty (e.g., server hides sample or Bedrock),
      // don't falsely close sessions if server is still online with same/nonzero count unless offline.
      const canTrustEmptySample = !result.online || result.playerCount === 0 || seenMap.size > 0;

      if (canTrustEmptySample) {
        for (const session of activeSessions) {
          if (!seenMap.has(session.username)) {
            const durationSec = Math.max(
              0,
              Math.floor(
                (parseSqliteTimestamp(nowIso) - parseSqliteTimestamp(session.joined_at)) / 1000,
              ),
            );
            this.ctx.db.run(
              `UPDATE mc_player_sessions SET left_at = ?, duration_seconds = ? WHERE id = ?`,
              nowIso,
              durationSec,
              session.id,
            );
            this.ctx.db.run(
              `UPDATE mc_players
               SET total_playtime_seconds = total_playtime_seconds + ?, last_seen = ?
               WHERE id = ?`,
              durationSec,
              nowIso,
              session.player_id,
            );
            left.push(session.username);
          }
        }
      }

      const activeNames = new Set(activeSessions.map((s) => s.username));
      for (const player of seenMap.values()) {
        if (activeNames.has(player.name)) {
          this.ctx.db.run(
            `UPDATE mc_players SET last_seen = ?, uuid = COALESCE(?, uuid) WHERE username = ?`,
            nowIso,
            player.id ?? null,
            player.name,
          );
          continue;
        }

        // Upsert player identity
        this.ctx.db.run(
          `INSERT INTO mc_players (username, uuid, first_seen, last_seen, session_count)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(username) DO UPDATE SET
             uuid = COALESCE(excluded.uuid, mc_players.uuid),
             last_seen = excluded.last_seen,
             session_count = mc_players.session_count + 1`,
          player.name,
          player.id ?? null,
          nowIso,
          nowIso,
        );

        const playerRow = this.ctx.db.get<{ id: number }>(
          'SELECT id FROM mc_players WHERE username = ?',
          player.name,
        )!;

        this.ctx.db.run(
          `INSERT INTO mc_player_sessions (server_id, player_id, username, joined_at)
           VALUES (?, ?, ?, ?)`,
          server.id,
          playerRow.id,
          player.name,
          nowIso,
        );

        joined.push(player.name);
      }
    });

    return { statusChanged, wasOnline, joined, left };
  }

  private async dispatchNotifications(
    server: McServerRow,
    result: McPingResult,
    outcome: { statusChanged: boolean; wasOnline: boolean | null; joined: string[]; left: string[] },
  ): Promise<void> {
    if (!this.ctx.client.isReady()) return;

    // Alert channel notifications
    if (server.alert_channel_id) {
      const channel = this.ctx.client.channels.cache.get(server.alert_channel_id);
      if (channel && channel.isTextBased() && 'send' in channel) {
        if (server.notify_offline === 1 && outcome.statusChanged) {
          const embed = new EmbedBuilder()
            .setTitle(
              result.online
                ? `Minecraft Server Online: ${server.name}`
                : `Minecraft Server Offline: ${server.name}`,
            )
            .setColor(result.online ? 0x10b981 : 0xef4444)
            .setDescription(
              result.online
                ? `\`${server.host}:${server.port}\` is back online (${result.latencyMs ?? '?'} ms).`
                : `\`${server.host}:${server.port}\` is unreachable.${result.errorMessage ? `\nReason: \`${result.errorMessage}\`` : ''}`,
            )
            .setTimestamp();
          await channel.send({ embeds: [embed] });
        }

        if (server.notify_players === 1 && (outcome.joined.length > 0 || outcome.left.length > 0)) {
          const lines: string[] = [];
          if (outcome.joined.length > 0) {
            lines.push(`**Joined:** ${outcome.joined.join(', ')}`);
          }
          if (outcome.left.length > 0) {
            lines.push(`**Left:** ${outcome.left.join(', ')}`);
          }
          const embed = new EmbedBuilder()
            .setTitle(`${server.name} — Player Activity`)
            .setColor(0x3b82f6)
            .setDescription(lines.join('\n'))
            .setFooter({ text: `Online: ${result.playerCount}/${result.maxPlayers}` })
            .setTimestamp();
          await channel.send({ embeds: [embed] });
        }
      }
    }

    // Live auto-updating status board embed
    if (server.status_channel_id && server.status_message_id) {
      const channel = this.ctx.client.channels.cache.get(server.status_channel_id);
      if (channel && channel.isTextBased() && 'messages' in channel) {
        const msg = await channel.messages.fetch(server.status_message_id).catch(() => null);
        if (msg) {
          const refreshed = this.ctx.db.get<McServerRow>(
            'SELECT * FROM mc_servers WHERE id = ?',
            server.id,
          );
          if (refreshed) {
            await msg.edit({ embeds: [this.buildServerEmbed(refreshed)] });
          }
        }
      }
    }
  }

  buildServerEmbed(server: McServerRow): EmbedBuilder {
    const isOnline = server.last_online === 1;
    const activePlayers = this.ctx.db.all<{ username: string }>(
      'SELECT username FROM mc_player_sessions WHERE server_id = ? AND left_at IS NULL ORDER BY username ASC',
      server.id,
    );
    const stats = this.getUptimeSummary(server.id, 24);

    const embed = new EmbedBuilder()
      .setTitle(`${isOnline ? '🟢' : '🔴'} ${server.name}`)
      .setColor(isOnline ? 0x10b981 : 0xef4444)
      .addFields(
        {
          name: 'Address',
          value: `\`${server.host}:${server.port}\` (${server.edition.toUpperCase()})`,
          inline: true,
        },
        {
          name: 'Status',
          value: isOnline ? 'Online' : 'Offline',
          inline: true,
        },
        {
          name: 'Latency',
          value: isOnline && server.last_latency_ms !== null ? `${server.last_latency_ms} ms` : '—',
          inline: true,
        },
        {
          name: 'Players',
          value: `${server.last_player_count} / ${server.last_max_players}`,
          inline: true,
        },
        {
          name: '24h Uptime',
          value: `${stats.uptimePct.toFixed(1)}%`,
          inline: true,
        },
        {
          name: 'Version',
          value: server.last_version ?? '—',
          inline: true,
        },
      )
      .setFooter({ text: 'Auto-updated by 24/7 Monitor' })
      .setTimestamp();

    if (server.last_motd) {
      embed.setDescription(`> ${server.last_motd.split('\n')[0]}`);
    }

    if (activePlayers.length > 0) {
      embed.addFields({
        name: 'Online Players',
        value: activePlayers.map((p) => `\`${p.username}\``).join(', ').slice(0, 1024),
      });
    }

    return embed;
  }

  listServers() {
    const rows = this.ctx.db.all<McServerRow>(
      'SELECT * FROM mc_servers ORDER BY id ASC',
    );
    return rows.map((row) => {
      const onlinePlayers = this.ctx.db.all<{ username: string; joined_at: string }>(
        'SELECT username, joined_at FROM mc_player_sessions WHERE server_id = ? AND left_at IS NULL ORDER BY username ASC',
        row.id,
      );
      const summary24h = this.getUptimeSummary(row.id, 24);
      return {
        ...sanitizeMcServer(row),
        onlinePlayers,
        uptime24hPct: summary24h.uptimePct,
        avgLatency24hMs: summary24h.avgLatencyMs,
      };
    });
  }

  getServer(id: number): McServerRow | undefined {
    return this.ctx.db.get<McServerRow>('SELECT * FROM mc_servers WHERE id = ?', id);
  }

  createServer(input: {
    name: string;
    host: string;
    port?: number;
    edition?: 'java' | 'bedrock';
    pollIntervalSec?: number;
    enabled?: boolean;
    guildId?: string | null;
    alertChannelId?: string | null;
    notifyOffline?: boolean;
    notifyPlayers?: boolean;
    rconPort?: number | null;
    rconPassword?: string | null;
  }) {
    const edition = input.edition ?? 'java';
    const port = input.port ?? (edition === 'bedrock' ? 19132 : 25565);
    const pollInterval = input.pollIntervalSec ?? this.ctx.config.mcDefaultPollIntervalSec;

    const res = this.ctx.db.run(
      `INSERT INTO mc_servers
        (name, host, port, edition, poll_interval_sec, enabled, guild_id, alert_channel_id, notify_offline, notify_players, rcon_port, rcon_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.name,
      input.host,
      port,
      edition,
      pollInterval,
      input.enabled === false ? 0 : 1,
      input.guildId ?? null,
      input.alertChannelId ?? null,
      input.notifyOffline === false ? 0 : 1,
      input.notifyPlayers ? 1 : 0,
      input.rconPort ?? null,
      input.rconPassword ?? null,
    );

    const createdId = Number(res.lastInsertRowid);
    this.nextCheckDue.set(createdId, 0);
    return sanitizeMcServer(this.getServer(createdId)!);
  }

  updateServer(
    id: number,
    patch: {
      name?: string;
      host?: string;
      port?: number;
      edition?: 'java' | 'bedrock';
      pollIntervalSec?: number;
      enabled?: boolean;
      guildId?: string | null;
      alertChannelId?: string | null;
      statusChannelId?: string | null;
      statusMessageId?: string | null;
      notifyOffline?: boolean;
      notifyPlayers?: boolean;
      rconPort?: number | null;
      rconPassword?: string | null;
    },
  ) {
    const existing = this.getServer(id);
    if (!existing) return null;

    this.ctx.db.run(
      `UPDATE mc_servers SET
        name = ?, host = ?, port = ?, edition = ?, poll_interval_sec = ?,
        enabled = ?, guild_id = ?, alert_channel_id = ?,
        status_channel_id = ?, status_message_id = ?,
        notify_offline = ?, notify_players = ?,
        rcon_port = ?, rcon_password = ?
       WHERE id = ?`,
      patch.name ?? existing.name,
      patch.host ?? existing.host,
      patch.port ?? existing.port,
      patch.edition ?? existing.edition,
      patch.pollIntervalSec ?? existing.poll_interval_sec,
      patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
      patch.guildId === undefined ? existing.guild_id : patch.guildId,
      patch.alertChannelId === undefined ? existing.alert_channel_id : patch.alertChannelId,
      patch.statusChannelId === undefined ? existing.status_channel_id : patch.statusChannelId,
      patch.statusMessageId === undefined ? existing.status_message_id : patch.statusMessageId,
      patch.notifyOffline === undefined
        ? existing.notify_offline
        : patch.notifyOffline
          ? 1
          : 0,
      patch.notifyPlayers === undefined
        ? existing.notify_players
        : patch.notifyPlayers
          ? 1
          : 0,
      patch.rconPort === undefined ? existing.rcon_port : patch.rconPort,
      patch.rconPassword === undefined ? existing.rcon_password : patch.rconPassword,
      id,
    );

    this.nextCheckDue.set(id, 0);
    return sanitizeMcServer(this.getServer(id)!);
  }

  deleteServer(id: number): boolean {
    const res = this.ctx.db.run('DELETE FROM mc_servers WHERE id = ?', id);
    this.nextCheckDue.delete(id);
    return Number(res.changes) > 0;
  }

  getUptimeSummary(serverId: number, hours: number) {
    const row = this.ctx.db.get<{
      total: number;
      online_count: number | null;
      avg_latency: number | null;
      peak_players: number | null;
    }>(
      `SELECT
         COUNT(*) as total,
         SUM(online) as online_count,
         AVG(CASE WHEN online = 1 THEN latency_ms END) as avg_latency,
         MAX(player_count) as peak_players
       FROM mc_server_checks
       WHERE server_id = ? AND checked_at >= datetime('now', ?)`,
      serverId,
      `-${hours} hours`,
    );

    const total = row?.total ?? 0;
    const onlineCount = row?.online_count ?? 0;
    return {
      totalChecks: total,
      uptimePct: total > 0 ? Number(((onlineCount / total) * 100).toFixed(2)) : 100,
      avgLatencyMs: row?.avg_latency ? Math.round(row.avg_latency) : null,
      peakPlayers: row?.peak_players ?? 0,
    };
  }

  getServerHistory(serverId: number, hours = 24) {
    const clampedHours = Math.min(Math.max(hours, 1), 24 * 30);
    const checks = this.ctx.db.all<{
      checked_at: string;
      online: number;
      latency_ms: number | null;
      player_count: number;
      max_players: number;
      error_message: string | null;
    }>(
      `SELECT checked_at, online, latency_ms, player_count, max_players, error_message
       FROM mc_server_checks
       WHERE server_id = ? AND checked_at >= datetime('now', ?)
       ORDER BY checked_at ASC`,
      serverId,
      `-${clampedHours} hours`,
    );

    // Downsample to max ~180 points for smooth charting
    const step = Math.max(1, Math.ceil(checks.length / 180));
    const points = checks
      .filter((_, idx) => idx % step === 0 || idx === checks.length - 1)
      .map((c) => ({
        timestamp: c.checked_at,
        online: c.online === 1,
        latencyMs: c.latency_ms,
        playerCount: c.player_count,
        maxPlayers: c.max_players,
      }));

    // Detect status transition incidents
    const incidents: {
      type: 'offline' | 'online';
      at: string;
      message: string | null;
    }[] = [];
    for (let i = 1; i < checks.length; i++) {
      if (checks[i].online !== checks[i - 1].online) {
        incidents.push({
          type: checks[i].online === 1 ? 'online' : 'offline',
          at: checks[i].checked_at,
          message: checks[i].error_message,
        });
      }
    }

    return {
      summary: this.getUptimeSummary(serverId, clampedHours),
      points,
      incidents: incidents.reverse().slice(0, 30),
    };
  }

  getPlayersOverview(options: { serverId?: number; search?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 300);
    const search = options.search?.trim() ? `%${options.search.trim()}%` : null;

    let sql = `
      SELECT
        p.id,
        p.username,
        p.uuid,
        p.first_seen,
        p.last_seen,
        p.total_playtime_seconds,
        p.session_count,
        active.server_id as active_server_id,
        srv.name as active_server_name,
        active.joined_at as active_joined_at
      FROM mc_players p
      LEFT JOIN mc_player_sessions active
        ON active.player_id = p.id AND active.left_at IS NULL
      LEFT JOIN mc_servers srv
        ON srv.id = active.server_id
    `;

    const where: string[] = [];
    const params: (string | number)[] = [];

    if (options.serverId) {
      where.push(
        `EXISTS (SELECT 1 FROM mc_player_sessions s WHERE s.player_id = p.id AND s.server_id = ?)`,
      );
      params.push(options.serverId);
    }

    if (search) {
      where.push(`p.username LIKE ?`);
      params.push(search);
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ` ORDER BY (active.id IS NOT NULL) DESC, p.total_playtime_seconds DESC LIMIT ?`;
    params.push(limit);

    const rows = this.ctx.db.all<{
      id: number;
      username: string;
      uuid: string | null;
      first_seen: string;
      last_seen: string;
      total_playtime_seconds: number;
      session_count: number;
      active_server_id: number | null;
      active_server_name: string | null;
      active_joined_at: string | null;
    }>(sql, ...params);

    const nowMs = Date.now();
    return rows.map((r) => {
      const activeExtraSec = r.active_joined_at
        ? Math.max(0, Math.floor((nowMs - parseSqliteTimestamp(r.active_joined_at)) / 1000))
        : 0;
      return {
        id: r.id,
        username: r.username,
        uuid: r.uuid,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        totalPlaytimeSeconds: r.total_playtime_seconds + activeExtraSec,
        sessionCount: r.session_count,
        onlineNow: r.active_server_id !== null,
        activeServerId: r.active_server_id,
        activeServerName: r.active_server_name,
      };
    });
  }

  getPlayerDetail(username: string) {
    const player = this.ctx.db.get<{
      id: number;
      username: string;
      uuid: string | null;
      first_seen: string;
      last_seen: string;
      total_playtime_seconds: number;
      session_count: number;
    }>(
      'SELECT * FROM mc_players WHERE LOWER(username) = LOWER(?)',
      username.trim(),
    );
    if (!player) return null;

    const sessions = this.ctx.db.all<{
      id: number;
      server_id: number;
      server_name: string;
      joined_at: string;
      left_at: string | null;
      duration_seconds: number;
    }>(
      `SELECT s.id, s.server_id, srv.name as server_name, s.joined_at, s.left_at, s.duration_seconds
       FROM mc_player_sessions s
       JOIN mc_servers srv ON srv.id = s.server_id
       WHERE s.player_id = ?
       ORDER BY s.joined_at DESC
       LIMIT 50`,
      player.id,
    );

    const serverBreakdown = this.ctx.db.all<{
      server_id: number;
      server_name: string;
      sessions: number;
      playtime_seconds: number;
    }>(
      `SELECT s.server_id, srv.name as server_name, COUNT(*) as sessions, SUM(s.duration_seconds) as playtime_seconds
       FROM mc_player_sessions s
       JOIN mc_servers srv ON srv.id = s.server_id
       WHERE s.player_id = ?
       GROUP BY s.server_id, srv.name
       ORDER BY playtime_seconds DESC`,
      player.id,
    );

    return {
      player: {
        id: player.id,
        username: player.username,
        uuid: player.uuid,
        firstSeen: player.first_seen,
        lastSeen: player.last_seen,
        totalPlaytimeSeconds: player.total_playtime_seconds,
        sessionCount: player.session_count,
      },
      sessions,
      serverBreakdown,
    };
  }

  async executeRcon(serverId: number, command: string): Promise<string> {
    const server = this.getServer(serverId);
    if (!server) throw new Error('Server not found');
    if (!server.rcon_port || !server.rcon_password) {
      throw new Error('RCON is not configured for this server');
    }

    const client = new RCON();
    await client.connect(server.host, server.rcon_port, { timeout: 5000 });
    try {
      await client.login(server.rcon_password, { timeout: 5000 });
      const response = await client.execute(command);
      return response || '(empty response)';
    } finally {
      await client.close();
    }
  }

  private pruneOldChecks(): void {
    const days = this.ctx.config.mcHistoryRetentionDays;
    const res = this.ctx.db.run(
      `DELETE FROM mc_server_checks WHERE checked_at < datetime('now', ?)`,
      `-${days} days`,
    );
    if (Number(res.changes) > 0) {
      this.ctx.logger.info(
        'module:minecraft',
        `Pruned ${res.changes} check record(s) older than ${days} days`,
      );
    }
  }
}

export function parseSqliteTimestamp(ts: string): number {
  // Handle "YYYY-MM-DD HH:MM:SS" (UTC) and ISO strings
  const normalized = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : Date.now();
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h ${mins}m`;
  }
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
