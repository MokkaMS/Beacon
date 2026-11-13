import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { BotModule } from '../../core/types.js';

/**
 * Reference template for creating new bot modules.
 * Copy this folder (or run `npm run create-module <id>`) to add a new module.
 * Modules whose folder name does NOT start with `_` are auto-discovered at startup.
 */
const templateModule: BotModule = {
  id: 'example',
  name: 'Example Module',
  description: 'A starter template module demonstrating commands, events, permissions, DB migrations, and API routes.',
  version: '1.0.0',
  author: 'Homelab',
  defaultEnabled: true,

  ui: {
    core: false,
    icon: 'Puzzle',
  },

  permissions: [
    {
      key: 'example.use',
      label: 'Use Example Features',
      description: 'Allows using the example slash command and API endpoints.',
    },
  ],

  migrations: [
    // {
    //   version: 1,
    //   sql: `CREATE TABLE IF NOT EXISTS example_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);`,
    // },
  ],

  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('example')
        .setDescription('Example slash command from the module template'),
      requiredPermission: 'example.use',
      execute: async (interaction) => {
        await interaction.reply({
          content: 'Hello from the example module!',
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  ],

  events: [],

  registerRoutes: async (fastify, ctx) => {
    fastify.get(
      '/ping',
      { preHandler: [ctx.auth.requirePermission('admin.view')] },
      async () => ({ ok: true, module: 'example' }),
    );
  },

  onLoad: async (ctx) => {
    ctx.logger.info('module:example', 'Example module loaded');
  },

  onUnload: async (ctx) => {
    ctx.logger.info('module:example', 'Example module unloaded');
  },
};

export default templateModule;
