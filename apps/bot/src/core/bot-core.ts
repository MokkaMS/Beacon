import {
  ActivityType,
  Client,
  GatewayIntentBits,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
} from 'discord.js';
import type { AppConfig } from '../config.js';
import type { ModuleContext } from './types.js';

export interface PresenceSettings {
  status: 'online' | 'idle' | 'dnd' | 'invisible';
  activityType: 'Playing' | 'Watching' | 'Listening' | 'Competing' | 'None';
  activityText: string;
}

const ACTIVITY_TYPE_MAP: Record<Exclude<PresenceSettings['activityType'], 'None'>, ActivityType> = {
  Playing: ActivityType.Playing,
  Watching: ActivityType.Watching,
  Listening: ActivityType.Listening,
  Competing: ActivityType.Competing,
};

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildPresences,
    ],
  });
}

export function wireDiscordCoreHandlers(
  client: Client,
  getContext: () => ModuleContext,
  config: AppConfig,
): void {
  client.once('ready', async (readyClient) => {
    const ctx = getContext();
    ctx.logger.info(
      'discord',
      `Logged in as ${readyClient.user.tag} across ${readyClient.guilds.cache.size} guild(s)`,
    );

    applyPresenceFromDb(ctx);

    try {
      await syncSlashCommands(ctx);
    } catch (error) {
      ctx.logger.error('discord', 'Failed to sync slash commands on startup', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  client.on('guildCreate', (guild) => {
    const ctx = getContext();
    ctx.db.run(
      `INSERT INTO guild_settings (guild_id, guild_name, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(guild_id) DO UPDATE SET guild_name = excluded.guild_name, updated_at = datetime('now')`,
      guild.id,
      guild.name,
    );
    ctx.logger.info('discord', `Joined guild "${guild.name}" (${guild.id})`);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const ctx = getContext();
    const match = ctx.moduleLoader.getCommand(interaction.commandName);

    if (!match) {
      await interaction.reply({
        content: 'Unknown command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!ctx.moduleLoader.isModuleEnabled(match.moduleId, interaction.guildId)) {
      await interaction.reply({
        content: `The **${match.moduleId}** module is currently disabled on this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (match.command.guildOnly && !interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used inside a Discord server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (match.command.requiredPermission) {
      const member = interaction.member instanceof GuildMember ? interaction.member : null;
      const roleIds = member
        ? Array.from(member.roles.cache.keys())
        : Array.isArray(interaction.member?.roles)
          ? interaction.member.roles
          : [];
      const isDiscordGuildAdmin = Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
      );

      const allowed = ctx.permissions.hasPermission(
        interaction.user.id,
        match.command.requiredPermission,
        {
          guildId: interaction.guildId ?? undefined,
          roleIds,
          isDiscordGuildAdmin,
        },
      );

      if (!allowed) {
        await interaction.reply({
          content: `Missing required permission: \`${match.command.requiredPermission}\`. An admin can grant it on the Admin Web-Page.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    try {
      await match.command.execute(interaction, ctx);
    } catch (error) {
      ctx.logger.error(
        `cmd:${interaction.commandName}`,
        'Error executing slash command',
        { error: error instanceof Error ? error.message : String(error) },
      );

      const errorMessage = 'Something went wrong while running this command.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      } else {
        await interaction.reply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }
  });

  if (!config.isDiscordConfigured) {
    getContext().logger.warn(
      'discord',
      'DISCORD_TOKEN or DISCORD_CLIENT_ID is missing. Running in Web-Only / Setup mode until configured.',
    );
  }
}

export function applyPresenceFromDb(ctx: ModuleContext): void {
  if (!ctx.client.user) return;
  const presence = ctx.db.getSetting<PresenceSettings>('botPresence', {
    status: 'online',
    activityType: 'Watching',
    activityText: 'Beacon • Homelab & Minecraft 24/7',
  });

  const activities =
    presence.activityType === 'None' || !presence.activityText.trim()
      ? []
      : [
          {
            name: presence.activityText.trim(),
            type: ACTIVITY_TYPE_MAP[presence.activityType],
          },
        ];

  ctx.client.user.setPresence({
    status: presence.status,
    activities,
  });
}

export async function syncSlashCommands(ctx: ModuleContext): Promise<number> {
  if (!ctx.config.isDiscordConfigured) return 0;

  const commands = ctx.moduleLoader.getAllSlashCommandJSON();
  const rest = new REST({ version: '10' }).setToken(ctx.config.discordToken);

  if (ctx.config.devGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(ctx.config.discordClientId, ctx.config.devGuildId),
      { body: commands },
    );
    ctx.logger.info(
      'discord',
      `Synced ${commands.length} slash command(s) to dev guild ${ctx.config.devGuildId}`,
    );
  } else {
    await rest.put(Routes.applicationCommands(ctx.config.discordClientId), {
      body: commands,
    });
    ctx.logger.info('discord', `Synced ${commands.length} global slash command(s)`);
  }

  return commands.length;
}
