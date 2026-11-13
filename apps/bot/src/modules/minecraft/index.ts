import {
  ChannelType,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';
import type { BotModule, ModuleContext } from '../../core/types.js';
import { minecraftMigrations } from './migrations.js';
import {
  formatDuration,
  MinecraftMonitorService,
  type McServerRow,
} from './monitor-service.js';

let monitorService: MinecraftMonitorService | null = null;

function getMonitor(ctx: ModuleContext): MinecraftMonitorService {
  if (!monitorService) {
    monitorService = new MinecraftMonitorService(ctx);
  }
  return monitorService;
}

function findServerByNameOrId(
  ctx: ModuleContext,
  query?: string | null,
): McServerRow | undefined {
  if (!query) {
    return ctx.db.get<McServerRow>('SELECT * FROM mc_servers ORDER BY id ASC LIMIT 1');
  }
  const asNum = Number(query);
  if (Number.isInteger(asNum) && asNum > 0) {
    const byId = ctx.db.get<McServerRow>('SELECT * FROM mc_servers WHERE id = ?', asNum);
    if (byId) return byId;
  }
  return ctx.db.get<McServerRow>(
    'SELECT * FROM mc_servers WHERE LOWER(name) LIKE LOWER(?) ORDER BY id ASC LIMIT 1',
    `%${query}%`,
  );
}

const createServerSchema = z.object({
  name: z.string().min(1).max(80),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  edition: z.enum(['java', 'bedrock']).default('java'),
  pollIntervalSec: z.number().int().min(10).max(3600).optional(),
  enabled: z.boolean().optional(),
  guildId: z.string().nullable().optional(),
  alertChannelId: z.string().nullable().optional(),
  notifyOffline: z.boolean().optional(),
  notifyPlayers: z.boolean().optional(),
  rconPort: z.number().int().min(1).max(65535).nullable().optional(),
  rconPassword: z.string().max(255).nullable().optional(),
});

const updateServerSchema = createServerSchema.partial();

const minecraftModule: BotModule = {
  id: 'minecraft',
  name: 'Minecraft 24/7 Monitor',
  description:
    '24/7 Minecraft server uptime & latency monitoring, player playtime history, live Discord status boards, and optional RCON.',
  version: '1.0.0',
  author: 'Beacon Core',
  defaultEnabled: true,

  ui: {
    core: false,
    navPath: '/minecraft',
    navLabel: 'Minecraft',
    icon: 'Gamepad2',
  },

  permissions: [
    {
      key: 'minecraft.view',
      label: 'View Minecraft Stats',
      description: 'Allows viewing monitored Minecraft servers, uptime history, and player stats.',
    },
    {
      key: 'minecraft.manage',
      label: 'Manage Minecraft Servers',
      description: 'Allows adding, editing, deleting, and pinging monitored Minecraft servers.',
    },
    {
      key: 'minecraft.rcon',
      label: 'Execute Minecraft RCON',
      description: 'Allows running remote console (RCON) commands on configured Minecraft servers.',
    },
  ],

  migrations: minecraftMigrations,

  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('mc')
        .setDescription('24/7 Minecraft server monitoring, player history, and utilities')
        .addSubcommand((sub) =>
          sub
            .setName('status')
            .setDescription('Show live status of monitored Minecraft servers')
            .addStringOption((opt) =>
              opt.setName('server').setDescription('Server name or ID (optional)'),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('players')
            .setDescription('Show online players and top playtime leaderboard')
            .addStringOption((opt) =>
              opt.setName('server').setDescription('Filter by server name or ID'),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('player')
            .setDescription('Look up a tracked player’s playtime and session history')
            .addStringOption((opt) =>
              opt
                .setName('username')
                .setDescription('Minecraft username')
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('history')
            .setDescription('Show uptime and incident history for a Minecraft server')
            .addStringOption((opt) =>
              opt.setName('server').setDescription('Server name or ID (optional)'),
            )
            .addIntegerOption((opt) =>
              opt
                .setName('hours')
                .setDescription('Lookback window in hours (default 24)')
                .setMinValue(1)
                .setMaxValue(720),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Add a Minecraft server to 24/7 monitoring')
            .addStringOption((opt) =>
              opt.setName('name').setDescription('Display name').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('host').setDescription('Hostname or IP').setRequired(true),
            )
            .addIntegerOption((opt) =>
              opt.setName('port').setDescription('Port (default 25565 Java / 19132 Bedrock)'),
            )
            .addStringOption((opt) =>
              opt
                .setName('edition')
                .setDescription('Server edition')
                .addChoices(
                  { name: 'Java Edition', value: 'java' },
                  { name: 'Bedrock Edition', value: 'bedrock' },
                ),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('setup-board')
            .setDescription('Post an auto-updating 24/7 live status board in a channel')
            .addStringOption((opt) =>
              opt.setName('server').setDescription('Server name or ID').setRequired(true),
            )
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Target text channel (defaults to current)')
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('rcon')
            .setDescription('Run an RCON command on a configured Minecraft server')
            .addStringOption((opt) =>
              opt.setName('server').setDescription('Server name or ID').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('command').setDescription('Console command').setRequired(true),
            ),
        ),
      execute: async (interaction, ctx) => {
        const monitor = getMonitor(ctx);
        const sub = interaction.options.getSubcommand();

        if (sub === 'status') {
          await interaction.deferReply();
          const query = interaction.options.getString('server');
          if (query) {
            const srv = findServerByNameOrId(ctx, query);
            if (!srv) {
              await interaction.editReply(`No monitored server matched \`${query}\`.`);
              return;
            }
            await monitor.pollServer(srv.id);
            const refreshed = monitor.getServer(srv.id)!;
            await interaction.editReply({ embeds: [monitor.buildServerEmbed(refreshed)] });
            return;
          }

          const servers = monitor.listServers();
          if (servers.length === 0) {
            await interaction.editReply(
              'No Minecraft servers are monitored yet. Use `/mc add` or add one on the Admin Web-Page.',
            );
            return;
          }

          const embed = new EmbedBuilder()
            .setTitle('Minecraft 24/7 Server Overview')
            .setColor(0x10b981)
            .setTimestamp();

          for (const srv of servers.slice(0, 10)) {
            const icon = srv.lastOnline ? '🟢' : srv.lastOnline === false ? '🔴' : '⚪';
            embed.addFields({
              name: `${icon} ${srv.name} (\`${srv.host}:${srv.port}\`)`,
              value: `Players: **${srv.lastPlayerCount}/${srv.lastMaxPlayers}** • Ping: **${srv.lastLatencyMs ?? '—'} ms** • 24h Uptime: **${srv.uptime24hPct}%**`,
            });
          }

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        if (sub === 'players') {
          const query = interaction.options.getString('server');
          const srv = query ? findServerByNameOrId(ctx, query) : undefined;
          if (query && !srv) {
            await interaction.reply({
              content: `No server matched \`${query}\`.`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const players = monitor.getPlayersOverview({ serverId: srv?.id, limit: 15 });
          if (players.length === 0) {
            await interaction.reply('No tracked player history recorded yet.');
            return;
          }

          const lines = players.map((p, idx) => {
            const badge = p.onlineNow ? `🟢 (${p.activeServerName})` : '⚫';
            return `${idx + 1}. ${badge} **${p.username}** — ${formatDuration(p.totalPlaytimeSeconds)} (${p.sessionCount} sessions)`;
          });

          const embed = new EmbedBuilder()
            .setTitle(srv ? `Players — ${srv.name}` : 'Minecraft Player Playtime Leaderboard')
            .setColor(0x6366f1)
            .setDescription(lines.join('\n'))
            .setTimestamp();

          await interaction.reply({ embeds: [embed] });
          return;
        }

        if (sub === 'player') {
          const username = interaction.options.getString('username', true);
          const detail = monitor.getPlayerDetail(username);
          if (!detail) {
            await interaction.reply({
              content: `No history found for player \`${username}\`.`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const { player, serverBreakdown } = detail;
          const embed = new EmbedBuilder()
            .setTitle(`Player Profile: ${player.username}`)
            .setColor(0x3b82f6)
            .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(player.username)}/128`)
            .addFields(
              {
                name: 'Total Playtime',
                value: formatDuration(player.totalPlaytimeSeconds),
                inline: true,
              },
              {
                name: 'Sessions',
                value: String(player.sessionCount),
                inline: true,
              },
              {
                name: 'Last Seen',
                value: player.lastSeen,
                inline: true,
              },
              {
                name: 'Servers Played',
                value:
                  serverBreakdown.length > 0
                    ? serverBreakdown
                        .map(
                          (b) =>
                            `• **${b.server_name}**: ${formatDuration(b.playtime_seconds)} (${b.sessions}x)`,
                        )
                        .join('\n')
                    : '_None_',
              },
            )
            .setTimestamp();

          await interaction.reply({ embeds: [embed] });
          return;
        }

        if (sub === 'history') {
          const srv = findServerByNameOrId(ctx, interaction.options.getString('server'));
          if (!srv) {
            await interaction.reply({
              content: 'No matching server found.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const hours = interaction.options.getInteger('hours') ?? 24;
          const history = monitor.getServerHistory(srv.id, hours);

          const incidentLines =
            history.incidents.length > 0
              ? history.incidents
                  .slice(0, 8)
                  .map(
                    (inc) =>
                      `${inc.type === 'online' ? '🟢 Recovered' : '🔴 Went Offline'} at \`${inc.at}\``,
                  )
                  .join('\n')
              : 'No outages recorded in this window.';

          const embed = new EmbedBuilder()
            .setTitle(`History (${hours}h) — ${srv.name}`)
            .setColor(0x8b5cf6)
            .addFields(
              { name: 'Uptime', value: `${history.summary.uptimePct}%`, inline: true },
              {
                name: 'Avg Latency',
                value:
                  history.summary.avgLatencyMs !== null
                    ? `${history.summary.avgLatencyMs} ms`
                    : '—',
                inline: true,
              },
              { name: 'Peak Players', value: String(history.summary.peakPlayers), inline: true },
              { name: 'Recent Status Events', value: incidentLines },
            )
            .setTimestamp();

          await interaction.reply({ embeds: [embed] });
          return;
        }

        // Permission-gated management subcommands
        const memberRoles: string[] =
          interaction.member instanceof GuildMember
            ? Array.from(interaction.member.roles.cache.keys())
            : Array.isArray(interaction.member?.roles)
              ? interaction.member.roles
              : [];

        if (sub === 'add' || sub === 'setup-board') {
          const allowed = ctx.permissions.hasPermission(interaction.user.id, 'minecraft.manage', {
            guildId: interaction.guildId ?? undefined,
            roleIds: memberRoles,
          });
          if (!allowed) {
            await interaction.reply({
              content: 'Missing permission `minecraft.manage`.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
        }

        if (sub === 'add') {
          const name = interaction.options.getString('name', true);
          const host = interaction.options.getString('host', true);
          const edition = (interaction.options.getString('edition') ?? 'java') as
            | 'java'
            | 'bedrock';
          const port =
            interaction.options.getInteger('port') ?? (edition === 'bedrock' ? 19132 : 25565);

          const created = monitor.createServer({
            name,
            host,
            port,
            edition,
            guildId: interaction.guildId,
            alertChannelId: interaction.channelId,
          });
          await interaction.deferReply();
          await monitor.pollServer(created.id);
          const refreshed = monitor.getServer(created.id)!;

          ctx.audit.record({
            actorId: interaction.user.id,
            actorName: interaction.user.tag,
            source: 'discord',
            guildId: interaction.guildId,
            action: 'minecraft.server.create',
            target: created.name,
          });

          await interaction.editReply({
            content: `Added **${created.name}** (\`${host}:${port}\`) to 24/7 monitoring!`,
            embeds: [monitor.buildServerEmbed(refreshed)],
          });
          return;
        }

        if (sub === 'setup-board') {
          if (!interaction.guild) {
            await interaction.reply({
              content: 'This command must be used inside a server.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const srv = findServerByNameOrId(ctx, interaction.options.getString('server', true));
          if (!srv) {
            await interaction.reply({
              content: 'Server not found.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const targetChannel =
            interaction.options.getChannel('channel') ?? interaction.channel;
          if (!targetChannel || !('send' in targetChannel)) {
            await interaction.reply({
              content: 'Target channel must be a text channel.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const msg = await targetChannel.send({ embeds: [monitor.buildServerEmbed(srv)] });
          monitor.updateServer(srv.id, {
            statusChannelId: targetChannel.id,
            statusMessageId: msg.id,
          });

          await interaction.reply({
            content: `Live auto-updating status board posted in <#${targetChannel.id}>!`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'rcon') {
          const allowed = ctx.permissions.hasPermission(interaction.user.id, 'minecraft.rcon', {
            guildId: interaction.guildId ?? undefined,
            roleIds: memberRoles,
          });
          if (!allowed) {
            await interaction.reply({
              content: 'Missing permission `minecraft.rcon`.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const srv = findServerByNameOrId(ctx, interaction.options.getString('server', true));
          const command = interaction.options.getString('command', true);
          if (!srv) {
            await interaction.reply({
              content: 'Server not found.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          try {
            const output = await monitor.executeRcon(srv.id, command);
            ctx.audit.record({
              actorId: interaction.user.id,
              actorName: interaction.user.tag,
              source: 'discord',
              guildId: interaction.guildId,
              action: 'minecraft.rcon',
              target: srv.name,
              details: { command },
            });
            await interaction.editReply(`**RCON (${srv.name})**\n\`\`\`\n${output.slice(0, 1800)}\n\`\`\``);
          } catch (err) {
            await interaction.editReply(
              `RCON error: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },
    },
  ],

  registerRoutes: async (fastify, ctx) => {
    const monitor = getMonitor(ctx);

    fastify.get(
      '/servers',
      { preHandler: [ctx.auth.requirePermission('minecraft.view')] },
      async () => {
        return { servers: monitor.listServers() };
      },
    );

    fastify.post(
      '/servers',
      { preHandler: [ctx.auth.requirePermission('minecraft.manage')] },
      async (request, reply) => {
        const parsed = createServerSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid server payload' });
        }

        const created = monitor.createServer(parsed.data);
        // Trigger immediate initial poll in background
        void monitor.pollServer(created.id);

        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          action: 'minecraft.server.create',
          target: created.name,
          details: { host: created.host, port: created.port, edition: created.edition },
        });

        return { server: created };
      },
    );

    fastify.patch<{ Params: { id: string } }>(
      '/servers/:id',
      { preHandler: [ctx.auth.requirePermission('minecraft.manage')] },
      async (request, reply) => {
        const id = Number(request.params.id);
        const parsed = updateServerSchema.safeParse(request.body);
        if (!parsed.success || !Number.isInteger(id)) {
          return reply.code(400).send({ error: 'Invalid server update payload' });
        }

        const updated = monitor.updateServer(id, parsed.data);
        if (!updated) return reply.code(404).send({ error: 'Server not found' });

        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          action: 'minecraft.server.update',
          target: updated.name,
        });

        return { server: updated };
      },
    );

    fastify.delete<{ Params: { id: string } }>(
      '/servers/:id',
      { preHandler: [ctx.auth.requirePermission('minecraft.manage')] },
      async (request, reply) => {
        const id = Number(request.params.id);
        const existing = monitor.getServer(id);
        if (!existing) return reply.code(404).send({ error: 'Server not found' });

        monitor.deleteServer(id);
        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          action: 'minecraft.server.delete',
          target: existing.name,
        });

        return { deleted: true };
      },
    );

    fastify.post<{ Params: { id: string } }>(
      '/servers/:id/poll',
      { preHandler: [ctx.auth.requirePermission('minecraft.view')] },
      async (request, reply) => {
        const id = Number(request.params.id);
        const result = await monitor.pollServer(id);
        if (!result) return reply.code(404).send({ error: 'Server not found' });
        return result;
      },
    );

    fastify.get<{ Params: { id: string }; Querystring: { hours?: string } }>(
      '/servers/:id/history',
      { preHandler: [ctx.auth.requirePermission('minecraft.view')] },
      async (request, reply) => {
        const id = Number(request.params.id);
        const server = monitor.getServer(id);
        if (!server) return reply.code(404).send({ error: 'Server not found' });

        const hours = Number(request.query.hours ?? 24);
        return monitor.getServerHistory(id, Number.isFinite(hours) ? hours : 24);
      },
    );

    fastify.post<{ Params: { id: string } }>(
      '/servers/:id/rcon',
      { preHandler: [ctx.auth.requirePermission('minecraft.rcon')] },
      async (request, reply) => {
        const id = Number(request.params.id);
        const parsed = z.object({ command: z.string().min(1).max(500) }).safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Command is required' });
        }

        try {
          const output = await monitor.executeRcon(id, parsed.data.command);
          ctx.audit.record({
            actorId: request.authUser!.id,
            actorName: request.authUser!.globalName ?? request.authUser!.username,
            source: 'web',
            action: 'minecraft.rcon',
            target: String(id),
            details: { command: parsed.data.command },
          });
          return { output };
        } catch (err) {
          return reply.code(400).send({
            error: err instanceof Error ? err.message : 'RCON execution failed',
          });
        }
      },
    );

    fastify.get<{ Querystring: { serverId?: string; search?: string } }>(
      '/players',
      { preHandler: [ctx.auth.requirePermission('minecraft.view')] },
      async (request) => {
        const serverId = request.query.serverId ? Number(request.query.serverId) : undefined;
        return {
          players: monitor.getPlayersOverview({
            serverId: serverId && Number.isFinite(serverId) ? serverId : undefined,
            search: request.query.search,
          }),
        };
      },
    );

    fastify.get<{ Params: { username: string } }>(
      '/players/:username',
      { preHandler: [ctx.auth.requirePermission('minecraft.view')] },
      async (request, reply) => {
        const detail = monitor.getPlayerDetail(request.params.username);
        if (!detail) return reply.code(404).send({ error: 'Player not found' });
        return detail;
      },
    );
  },

  onLoad: async (ctx) => {
    const monitor = getMonitor(ctx);
    monitor.start();
  },

  onUnload: async () => {
    monitorService?.stop();
    monitorService = null;
  },
};

export default minecraftModule;
