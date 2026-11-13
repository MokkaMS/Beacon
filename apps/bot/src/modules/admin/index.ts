import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { z } from 'zod';
import {
  applyPresenceFromDb,
  syncSlashCommands,
  type PresenceSettings,
} from '../../core/bot-core.js';
import type { BotModule, ModuleContext } from '../../core/types.js';

const upsertUserPermSchema = z.object({
  guildId: z.string().min(1).default('*'),
  userId: z.string().regex(/^\d{17,22}$/, 'Valid Discord User ID required'),
  usernameCache: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  isAdmin: z.boolean().default(false),
  note: z.string().max(200).optional(),
});

const upsertRolePermSchema = z.object({
  guildId: z.string().min(1),
  roleId: z.string().regex(/^\d{17,22}$/, 'Valid Discord Role ID required'),
  roleNameCache: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  isAdmin: z.boolean().default(false),
});

const announceSchema = z.object({
  channelId: z.string().min(1),
  title: z.string().max(256).optional(),
  message: z.string().min(1).max(4000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  useEmbed: z.boolean().default(true),
});

const memberActionSchema = z.object({
  action: z.enum(['add_role', 'remove_role', 'timeout', 'kick', 'ban', 'nickname']),
  roleId: z.string().optional(),
  durationMinutes: z.number().int().min(0).max(40320).optional(),
  nickname: z.string().max(32).optional(),
  reason: z.string().max(300).optional(),
});

const presenceSchema = z.object({
  status: z.enum(['online', 'idle', 'dnd', 'invisible']),
  activityType: z.enum(['Playing', 'Watching', 'Listening', 'Competing', 'None']),
  activityText: z.string().max(128),
});

function getGuildModuleDisabledList(ctx: ModuleContext, guildId: string): string[] {
  const row = ctx.db.get<{ disabled_modules: string }>(
    'SELECT disabled_modules FROM guild_settings WHERE guild_id = ?',
    guildId,
  );
  if (!row) return [];
  try {
    return JSON.parse(row.disabled_modules) as string[];
  } catch {
    return [];
  }
}

const adminModule: BotModule = {
  id: 'admin',
  name: 'Admin & Server Management',
  description:
    'Core administration module providing Discord user/role permissions, server management, announcements, and bot settings.',
  version: '1.0.0',
  author: 'Beacon Core',
  defaultEnabled: true,

  ui: {
    core: true,
    navPath: '/servers',
    navLabel: 'Servers',
    icon: 'Server',
  },

  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Bot administration & permission utilities')
        .addSubcommand((sub) =>
          sub.setName('info').setDescription('Show bot status, loaded modules, and Admin Web-Page URL'),
        )
        .addSubcommand((sub) =>
          sub
            .setName('perm-check')
            .setDescription('Check effective bot permissions for a user in this server')
            .addUserOption((opt) =>
              opt.setName('user').setDescription('Target user (defaults to you)'),
            ),
        ),
      execute: async (interaction, ctx) => {
        const sub = interaction.options.getSubcommand();

        if (sub === 'info') {
          const modules = ctx.moduleLoader.listModules();
          const enabledCount = modules.filter((m) => m.enabled).length;
          const embed = new EmbedBuilder()
            .setTitle('Beacon — Modular Bot')
            .setColor(0x6366f1)
            .addFields(
              {
                name: 'Modules',
                value: `${enabledCount} / ${modules.length} enabled`,
                inline: true,
              },
              {
                name: 'Servers',
                value: String(ctx.client.guilds.cache.size),
                inline: true,
              },
              {
                name: 'Ping',
                value: `${Math.max(0, Math.round(ctx.client.ws.ping))} ms`,
                inline: true,
              },
              {
                name: 'Admin Web-Page',
                value: ctx.config.publicUrl,
              },
            )
            .setTimestamp();

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          return;
        }

        if (sub === 'perm-check') {
          const target = interaction.options.getUser('user') ?? interaction.user;
          const guild = interaction.guild;
          let roleIds: string[] = [];
          if (guild) {
            const member = await guild.members.fetch(target.id).catch(() => null);
            if (member) {
              roleIds = Array.from(member.roles.cache.keys());
            }
          }

          const map = new Map<string, string[]>();
          if (guild) map.set(guild.id, roleIds);
          const effective = ctx.permissions.getEffectivePermissions(target.id, map);

          const embed = new EmbedBuilder()
            .setTitle(`Permissions for ${target.tag}`)
            .setColor(effective.isOwner || effective.isGlobalAdmin ? 0x10b981 : 0x3b82f6)
            .addFields(
              { name: 'Bot Owner', value: effective.isOwner ? 'Yes' : 'No', inline: true },
              {
                name: 'Global Admin',
                value: effective.isGlobalAdmin ? 'Yes' : 'No',
                inline: true,
              },
              {
                name: 'Assigned Permissions',
                value:
                  effective.permissions.length > 0
                    ? effective.permissions.map((p) => `\`${p}\``).join(', ')
                    : '_None_',
              },
            );

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
      },
    },
  ],

  registerRoutes: async (fastify, ctx) => {
    // ---- Permission Management ----
    fastify.get(
      '/permissions/definitions',
      { preHandler: [ctx.auth.requirePermission('admin.view')] },
      async () => {
        return { definitions: ctx.permissions.listDefinitions() };
      },
    );

    fastify.get<{ Querystring: { guildId?: string } }>(
      '/permissions/users',
      { preHandler: [ctx.auth.requirePermission('admin.permissions')] },
      async (request) => {
        return {
          users: ctx.permissions.listUserPermissions(request.query.guildId),
          botOwnerIds: ctx.config.botOwnerIds,
        };
      },
    );

    fastify.put(
      '/permissions/users',
      { preHandler: [ctx.auth.requirePermission('admin.permissions')] },
      async (request, reply) => {
        const parsed = upsertUserPermSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
        }

        let usernameCache = parsed.data.usernameCache ?? '';
        if (!usernameCache && ctx.client.isReady()) {
          const fetched = await ctx.client.users.fetch(parsed.data.userId).catch(() => null);
          if (fetched) usernameCache = fetched.tag;
        }

        const record = ctx.permissions.upsertUserPermission({
          ...parsed.data,
          usernameCache,
        });

        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          guildId: parsed.data.guildId === '*' ? null : parsed.data.guildId,
          action: 'permission.user.upsert',
          target: parsed.data.userId,
          details: { isAdmin: parsed.data.isAdmin, permissions: parsed.data.permissions },
        });

        return { user: record };
      },
    );

    fastify.delete<{ Params: { guildId: string; userId: string } }>(
      '/permissions/users/:guildId/:userId',
      { preHandler: [ctx.auth.requirePermission('admin.permissions')] },
      async (request) => {
        const deleted = ctx.permissions.deleteUserPermission(
          request.params.guildId,
          request.params.userId,
        );
        if (deleted) {
          ctx.audit.record({
            actorId: request.authUser!.id,
            actorName: request.authUser!.globalName ?? request.authUser!.username,
            source: 'web',
            guildId: request.params.guildId === '*' ? null : request.params.guildId,
            action: 'permission.user.delete',
            target: request.params.userId,
          });
        }
        return { deleted };
      },
    );

    fastify.get<{ Querystring: { guildId?: string } }>(
      '/permissions/roles',
      { preHandler: [ctx.auth.requirePermission('admin.permissions')] },
      async (request) => {
        return { roles: ctx.permissions.listRolePermissions(request.query.guildId) };
      },
    );

    fastify.put(
      '/permissions/roles',
      { preHandler: [ctx.auth.requirePermission('admin.permissions')] },
      async (request, reply) => {
        const parsed = upsertRolePermSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
        }

        let roleNameCache = parsed.data.roleNameCache ?? '';
        if (!roleNameCache && ctx.client.isReady()) {
          const guild = ctx.client.guilds.cache.get(parsed.data.guildId);
          const role = guild?.roles.cache.get(parsed.data.roleId);
          if (role) roleNameCache = role.name;
        }

        const record = ctx.permissions.upsertRolePermission({
          ...parsed.data,
          roleNameCache,
        });

        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          guildId: parsed.data.guildId,
          action: 'permission.role.upsert',
          target: parsed.data.roleId,
          details: { isAdmin: parsed.data.isAdmin, permissions: parsed.data.permissions },
        });

        return { role: record };
      },
    );

    fastify.delete<{ Params: { guildId: string; roleId: string } }>(
      '/permissions/roles/:guildId/:roleId',
      { preHandler: [ctx.auth.requirePermission('admin.permissions')] },
      async (request) => {
        const deleted = ctx.permissions.deleteRolePermission(
          request.params.guildId,
          request.params.roleId,
        );
        if (deleted) {
          ctx.audit.record({
            actorId: request.authUser!.id,
            actorName: request.authUser!.globalName ?? request.authUser!.username,
            source: 'web',
            guildId: request.params.guildId,
            action: 'permission.role.delete',
            target: request.params.roleId,
          });
        }
        return { deleted };
      },
    );

    // ---- Discord Server Management ----
    fastify.get(
      '/guilds',
      { preHandler: [ctx.auth.requirePermission('admin.view')] },
      async () => {
        if (!ctx.client.isReady()) {
          return { guilds: [], ready: false };
        }

        const guilds = Array.from(ctx.client.guilds.cache.values()).map((guild) => ({
          id: guild.id,
          name: guild.name,
          iconUrl: guild.iconURL({ size: 128 }),
          memberCount: guild.memberCount,
          ownerId: guild.ownerId,
          channelCount: guild.channels.cache.size,
          roleCount: guild.roles.cache.size,
          disabledModules: getGuildModuleDisabledList(ctx, guild.id),
        }));

        return { guilds, ready: true };
      },
    );

    fastify.get<{ Params: { guildId: string }; Querystring: { memberQuery?: string } }>(
      '/guilds/:guildId',
      {
        preHandler: [
          ctx.auth.requirePermission('admin.servers', (req) => (req.params as { guildId: string }).guildId),
        ],
      },
      async (request, reply) => {
        if (!ctx.client.isReady()) {
          return reply.code(503).send({ error: 'Discord client is not connected yet' });
        }

        const guild = ctx.client.guilds.cache.get(request.params.guildId);
        if (!guild) {
          return reply.code(404).send({ error: 'Server not found' });
        }

        const channels = Array.from(guild.channels.cache.values())
          .sort((a, b) => ('rawPosition' in a && 'rawPosition' in b ? a.rawPosition - b.rawPosition : 0))
          .map((ch) => ({
            id: ch.id,
            name: ch.name,
            type: ChannelType[ch.type] ?? String(ch.type),
            isText: ch.isTextBased(),
            parentId: ch.parentId,
          }));

        const roles = Array.from(guild.roles.cache.values())
          .filter((r) => r.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .map((r) => ({
            id: r.id,
            name: r.name,
            color: r.hexColor,
            position: r.position,
            managed: r.managed,
          }));

        // Fetch or filter members safely
        const query = request.query.memberQuery?.trim().toLowerCase();
        if (query && guild.members.cache.size < guild.memberCount) {
          await guild.members.search({ query, limit: 25 }).catch(() => {});
        } else if (guild.members.cache.size <= 1) {
          await guild.members.fetch({ limit: 50 }).catch(() => {});
        }

        let members = Array.from(guild.members.cache.values()).filter((m) => !m.user.bot);
        if (query) {
          members = members.filter(
            (m) =>
              m.user.username.toLowerCase().includes(query) ||
              m.displayName.toLowerCase().includes(query) ||
              m.id === query,
          );
        }

        const memberList = members.slice(0, 50).map((m) => ({
          id: m.id,
          username: m.user.username,
          displayName: m.displayName,
          avatarUrl: m.user.displayAvatarURL({ size: 64 }),
          roles: Array.from(m.roles.cache.keys()).filter((id) => id !== guild.id),
          isAdmin: m.permissions.has(PermissionFlagsBits.Administrator),
          joinedAt: m.joinedAt?.toISOString() ?? null,
          timedOutUntil: m.communicationDisabledUntil?.toISOString() ?? null,
        }));

        const settingsRow = ctx.db.get<{ log_channel_id: string | null; disabled_modules: string }>(
          'SELECT log_channel_id, disabled_modules FROM guild_settings WHERE guild_id = ?',
          guild.id,
        );

        return {
          guild: {
            id: guild.id,
            name: guild.name,
            iconUrl: guild.iconURL({ size: 128 }),
            memberCount: guild.memberCount,
            ownerId: guild.ownerId,
            logChannelId: settingsRow?.log_channel_id ?? null,
            disabledModules: getGuildModuleDisabledList(ctx, guild.id),
          },
          channels,
          roles,
          members: memberList,
        };
      },
    );

    fastify.patch<{ Params: { guildId: string } }>(
      '/guilds/:guildId/settings',
      {
        preHandler: [
          ctx.auth.requirePermission('admin.servers', (req) => (req.params as { guildId: string }).guildId),
        ],
      },
      async (request, reply) => {
        const schema = z.object({
          logChannelId: z.string().nullable().optional(),
          moduleToggles: z.record(z.string(), z.boolean()).optional(),
        });
        const parsed = schema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Invalid settings payload' });
        }

        const guildId = request.params.guildId;
        const guildName = ctx.client.guilds.cache.get(guildId)?.name ?? '';

        if (parsed.data.logChannelId !== undefined) {
          ctx.db.run(
            `INSERT INTO guild_settings (guild_id, guild_name, log_channel_id, updated_at)
             VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(guild_id) DO UPDATE SET
               guild_name = COALESCE(NULLIF(excluded.guild_name, ''), guild_settings.guild_name),
               log_channel_id = excluded.log_channel_id,
               updated_at = datetime('now')`,
            guildId,
            guildName,
            parsed.data.logChannelId,
          );
        }

        if (parsed.data.moduleToggles) {
          for (const [moduleId, enabled] of Object.entries(parsed.data.moduleToggles)) {
            ctx.moduleLoader.setGuildModuleEnabled(guildId, moduleId, enabled);
          }
        }

        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          guildId,
          action: 'guild.settings.update',
          details: parsed.data,
        });

        return {
          ok: true,
          disabledModules: getGuildModuleDisabledList(ctx, guildId),
        };
      },
    );

    fastify.post<{ Params: { guildId: string } }>(
      '/guilds/:guildId/announce',
      {
        preHandler: [
          ctx.auth.requirePermission('admin.servers', (req) => (req.params as { guildId: string }).guildId),
        ],
      },
      async (request, reply) => {
        const parsed = announceSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
        }

        const guild = ctx.client.guilds.cache.get(request.params.guildId);
        if (!guild) return reply.code(404).send({ error: 'Server not found' });

        const channel = guild.channels.cache.get(parsed.data.channelId);
        if (!channel || !channel.isTextBased() || !('send' in channel)) {
          return reply.code(400).send({ error: 'Channel is not a sendable text channel' });
        }

        if (parsed.data.useEmbed) {
          const colorInt = parsed.data.color
            ? parseInt(parsed.data.color.replace('#', ''), 16)
            : 0x6366f1;
          const embed = new EmbedBuilder()
            .setDescription(parsed.data.message)
            .setColor(colorInt)
            .setTimestamp();
          if (parsed.data.title) embed.setTitle(parsed.data.title);
          await channel.send({ embeds: [embed] });
        } else {
          const content = parsed.data.title
            ? `**${parsed.data.title}**\n${parsed.data.message}`
            : parsed.data.message;
          await channel.send({ content });
        }

        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          guildId: guild.id,
          action: 'guild.announce',
          target: channel.id,
          details: { title: parsed.data.title ?? null },
        });

        return { ok: true };
      },
    );

    fastify.post<{ Params: { guildId: string; userId: string } }>(
      '/guilds/:guildId/members/:userId/action',
      {
        preHandler: [
          ctx.auth.requirePermission('admin.servers', (req) => (req.params as { guildId: string }).guildId),
        ],
      },
      async (request, reply) => {
        const parsed = memberActionSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid action' });
        }

        const guild = ctx.client.guilds.cache.get(request.params.guildId);
        if (!guild) return reply.code(404).send({ error: 'Server not found' });

        const member = await guild.members.fetch(request.params.userId).catch(() => null);
        if (!member) return reply.code(404).send({ error: 'Member not found in server' });

        const { action, roleId, durationMinutes, nickname, reason } = parsed.data;
        const auditReason = reason || `Web Admin action by ${request.authUser!.username}`;

        try {
          if (action === 'add_role' && roleId) {
            await member.roles.add(roleId, auditReason);
          } else if (action === 'remove_role' && roleId) {
            await member.roles.remove(roleId, auditReason);
          } else if (action === 'timeout') {
            const ms = (durationMinutes ?? 10) * 60 * 1000;
            await member.timeout(ms > 0 ? ms : null, auditReason);
          } else if (action === 'kick') {
            await member.kick(auditReason);
          } else if (action === 'ban') {
            await member.ban({ reason: auditReason });
          } else if (action === 'nickname') {
            await member.setNickname(nickname ?? null, auditReason);
          } else {
            return reply.code(400).send({ error: 'Incomplete parameters for member action' });
          }
        } catch (err) {
          return reply.code(400).send({
            error:
              err instanceof Error
                ? `Discord rejected action: ${err.message}`
                : 'Discord rejected action (check bot role hierarchy)',
          });
        }

        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          guildId: guild.id,
          action: `guild.member.${action}`,
          target: member.id,
          details: { roleId, durationMinutes, reason: auditReason },
        });

        return { ok: true };
      },
    );

    // ---- Bot Settings & System ----
    fastify.get(
      '/settings',
      { preHandler: [ctx.auth.requirePermission('admin.view')] },
      async () => {
        return {
          presence: ctx.db.getSetting<PresenceSettings>('botPresence', {
            status: 'online',
            activityType: 'Watching',
            activityText: 'Beacon • Homelab & Minecraft 24/7',
          }),
          allowGuildAdminBypass: ctx.db.getSetting<boolean>('allowGuildAdminBypass', true),
        };
      },
    );

    fastify.put(
      '/settings/presence',
      { preHandler: [ctx.auth.requirePermission('admin.settings')] },
      async (request, reply) => {
        const parsed = presenceSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Invalid presence settings' });
        }
        ctx.db.setSetting('botPresence', parsed.data);
        applyPresenceFromDb(ctx);

        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          action: 'bot.presence.update',
          details: parsed.data,
        });

        return { ok: true, presence: parsed.data };
      },
    );

    fastify.put(
      '/settings/general',
      { preHandler: [ctx.auth.requirePermission('admin.settings')] },
      async (request, reply) => {
        const parsed = z
          .object({ allowGuildAdminBypass: z.boolean() })
          .safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Invalid general settings' });
        }
        ctx.db.setSetting('allowGuildAdminBypass', parsed.data.allowGuildAdminBypass);
        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          action: 'bot.settings.update',
          details: parsed.data,
        });
        return { ok: true };
      },
    );

    fastify.post(
      '/sync-commands',
      { preHandler: [ctx.auth.requirePermission('admin.settings')] },
      async (request, reply) => {
        try {
          const count = await syncSlashCommands(ctx);
          ctx.audit.record({
            actorId: request.authUser!.id,
            actorName: request.authUser!.globalName ?? request.authUser!.username,
            source: 'web',
            action: 'bot.commands.sync',
            details: { count },
          });
          return { ok: true, count };
        } catch (err) {
          return reply.code(500).send({
            error: err instanceof Error ? err.message : 'Failed to sync slash commands',
          });
        }
      },
    );

    fastify.get<{ Querystring: { limit?: string; guildId?: string } }>(
      '/audit-logs',
      { preHandler: [ctx.auth.requirePermission('admin.view')] },
      async (request) => {
        const limit = Number(request.query.limit ?? 50);
        return {
          logs: ctx.audit.listRecent({
            limit: Number.isFinite(limit) ? limit : 50,
            guildId: request.query.guildId,
          }),
        };
      },
    );
  },
};

export default adminModule;
