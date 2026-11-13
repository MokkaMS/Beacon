import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import {
  createAuthHelpers,
  SESSION_COOKIE,
  signSessionToken,
} from '../src/api/auth.js';
import { createApiServer } from '../src/api/server.js';
import { AuditService } from '../src/core/audit-service.js';
import { createDiscordClient } from '../src/core/bot-core.js';
import { AppDatabase } from '../src/core/database.js';
import { Logger } from '../src/core/logger.js';
import { ModuleLoader } from '../src/core/module-loader.js';
import { PermissionService } from '../src/core/permission-service.js';
import type { ModuleContext } from '../src/core/types.js';
import adminModule from '../src/modules/admin/index.js';
import minecraftModule from '../src/modules/minecraft/index.js';

test('API enforces auth & permissions and serves Minecraft + Admin endpoints', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    BOT_OWNER_IDS: '100000000000000001',
    SESSION_SECRET: 'test-session-secret-that-is-over-32-chars-long',
  });
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

  moduleLoader.setContext(ctx);
  await moduleLoader.registerModule(adminModule);
  await moduleLoader.registerModule(minecraftModule);
  const fastify = await createApiServer(ctx);

  try {
    // 1. Public healthcheck
    const healthRes = await fastify.inject({ method: 'GET', url: '/api/health' });
    assert.equal(healthRes.statusCode, 200);
    assert.equal(healthRes.json().ok, true);

    // 2. Unauthenticated overview -> 401
    const unauthRes = await fastify.inject({ method: 'GET', url: '/api/overview' });
    assert.equal(unauthRes.statusCode, 401);

    // 3. Regular user without minecraft.manage -> 403 on POST /api/modules/minecraft/servers
    permissions.upsertUserPermission({
      guildId: '*',
      userId: '200000000000000002',
      permissions: ['admin.view', 'minecraft.view'],
      isAdmin: false,
    });

    const viewerToken = await signSessionToken(
      {
        id: '200000000000000002',
        username: 'viewer',
        globalName: 'Viewer',
        avatarUrl: '',
        isBotOwner: false,
        guildIds: [],
      },
      config.sessionSecret,
    );

    const forbiddenCreate = await fastify.inject({
      method: 'POST',
      url: '/api/modules/minecraft/servers',
      headers: { cookie: `${SESSION_COOKIE}=${viewerToken}` },
      payload: { name: 'Test MC', host: '127.0.0.1' },
    });
    assert.equal(forbiddenCreate.statusCode, 403);

    // 4. Bot Owner -> 200 on creating & listing Minecraft servers
    const ownerToken = await signSessionToken(
      {
        id: '100000000000000001',
        username: 'owner',
        globalName: 'Owner',
        avatarUrl: '',
        isBotOwner: true,
        guildIds: [],
      },
      config.sessionSecret,
    );

    const createRes = await fastify.inject({
      method: 'POST',
      url: '/api/modules/minecraft/servers',
      headers: { cookie: `${SESSION_COOKIE}=${ownerToken}` },
      payload: { name: 'SMP Server', host: 'mc.homelab.local', port: 25565, edition: 'java' },
    });
    assert.equal(createRes.statusCode, 200);
    assert.equal(createRes.json().server.name, 'SMP Server');

    const listRes = await fastify.inject({
      method: 'GET',
      url: '/api/modules/minecraft/servers',
      headers: { cookie: `${SESSION_COOKIE}=${viewerToken}` },
    });
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.json().servers.length, 1);
  } finally {
    await moduleLoader.unloadAll();
    await fastify.close();
    client.destroy();
    db.close();
  }
});
