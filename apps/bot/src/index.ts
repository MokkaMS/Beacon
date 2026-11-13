import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createApiServer } from './api/server.js';
import { createAuthHelpers } from './api/auth.js';
import { AuditService } from './core/audit-service.js';
import { createDiscordClient, wireDiscordCoreHandlers } from './core/bot-core.js';
import { AppDatabase } from './core/database.js';
import { Logger } from './core/logger.js';
import { ModuleLoader } from './core/module-loader.js';
import { PermissionService } from './core/permission-service.js';
import type { ModuleContext } from './core/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(500);
  const db = new AppDatabase(config.databasePath, logger);
  const permissions = new PermissionService(db, config);
  const audit = new AuditService(db);
  const moduleLoader = new ModuleLoader();
  const client = createDiscordClient();

  let ctx!: ModuleContext;
  const auth = createAuthHelpers(() => ctx);

  ctx = {
    config,
    db,
    logger,
    client,
    permissions,
    audit,
    moduleLoader,
    auth,
  };

  moduleLoader.setContext(ctx);
  wireDiscordCoreHandlers(client, () => ctx, config);

  const modulesDir = join(__dirname, 'modules');
  const discovered = await moduleLoader.discoverModules(modulesDir);
  for (const mod of discovered) {
    await moduleLoader.registerModule(mod);
  }

  const fastify = await createApiServer(ctx);
  await fastify.listen({ port: config.port, host: config.host });
  logger.info('web', `Admin Web-Page listening on http://${config.host}:${config.port}`);

  if (config.isDiscordConfigured) {
    client.login(config.discordToken).catch((err) => {
      logger.error('discord', 'Failed to login to Discord', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('core', `Received ${signal}, shutting down gracefully...`);
    try {
      await moduleLoader.unloadAll();
      await fastify.close();
      client.destroy();
      db.close();
    } catch (err) {
      logger.error('core', 'Error during shutdown', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
