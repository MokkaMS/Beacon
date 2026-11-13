import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SlashCommandBuilder } from 'discord.js';
import { loadConfig } from '../src/config.js';
import { createAuthHelpers } from '../src/api/auth.js';
import { AuditService } from '../src/core/audit-service.js';
import { createDiscordClient } from '../src/core/bot-core.js';
import { AppDatabase } from '../src/core/database.js';
import { Logger } from '../src/core/logger.js';
import { ModuleLoader } from '../src/core/module-loader.js';
import { PermissionService } from '../src/core/permission-service.js';
import type { BotModule, ModuleContext } from '../src/core/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('ModuleLoader discovers real modules, skips _template, and supports dynamic toggling', async () => {
  const config = loadConfig();
  const logger = new Logger(50);
  const db = new AppDatabase(':memory:', logger);
  const permissions = new PermissionService(db, config);
  const audit = new AuditService(db);
  const moduleLoader = new ModuleLoader();
  const client = createDiscordClient();

  let ctx!: ModuleContext;
  ctx = {
    config,
    db,
    logger,
    client,
    permissions,
    audit,
    moduleLoader,
    auth: createAuthHelpers(() => ctx),
  };

  try {
    moduleLoader.setContext(ctx);
    const modulesDir = join(__dirname, '../src/modules');
    const discovered = await moduleLoader.discoverModules(modulesDir);
    const ids = discovered.map((m) => m.id);

    assert.ok(ids.includes('admin'));
    assert.ok(ids.includes('minecraft'));
    assert.ok(!ids.includes('example'), '_template must be skipped');

    let loadedCount = 0;
    let unloadedCount = 0;

    const customModule: BotModule = {
      id: 'sample-plugin',
      name: 'Sample Plugin',
      description: 'Test plugin',
      version: '1.0.0',
      defaultEnabled: true,
      commands: [
        {
          data: new SlashCommandBuilder().setName('sample').setDescription('Sample command'),
          execute: async () => {},
        },
      ],
      onLoad: () => {
        loadedCount++;
      },
      onUnload: () => {
        unloadedCount++;
      },
    };

    await moduleLoader.registerModule(customModule);
    assert.equal(loadedCount, 1);
    assert.equal(moduleLoader.isModuleEnabled('sample-plugin'), true);
    assert.ok(moduleLoader.getCommand('sample'));

    // Disable globally
    await moduleLoader.setModuleEnabled('sample-plugin', false);
    assert.equal(unloadedCount, 1);
    assert.equal(moduleLoader.isModuleEnabled('sample-plugin'), false);

    // Re-enable globally and disable per-guild
    await moduleLoader.setModuleEnabled('sample-plugin', true);
    assert.equal(loadedCount, 2);
    moduleLoader.setGuildModuleEnabled('guild-1', 'sample-plugin', false);
    assert.equal(moduleLoader.isModuleEnabled('sample-plugin', 'guild-1'), false);
    assert.equal(moduleLoader.isModuleEnabled('sample-plugin', 'guild-2'), true);

    await moduleLoader.unloadAll();
  } finally {
    client.destroy();
    db.close();
  }
});
