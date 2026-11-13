import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import type { ModuleContext } from '../core/types.js';
import { registerAuthRoutes } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createApiServer(ctx: ModuleContext): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false,
    trustProxy: true, // Important behind Cloudflare Tunnel / reverse proxy
  });

  await fastify.register(cookie);

  if (ctx.config.nodeEnv === 'development') {
    await fastify.register(cors, {
      origin: true,
      credentials: true,
    });
  }

  // Public health endpoint for Docker & Cloudflare Tunnel healthchecks
  fastify.get('/api/health', async () => {
    return {
      ok: true,
      uptimeSec: Math.floor(process.uptime()),
      discordReady: ctx.client.isReady(),
      modulesCount: ctx.moduleLoader.listModules().length,
      timestamp: new Date().toISOString(),
    };
  });

  // Auth routes
  registerAuthRoutes(fastify, ctx);

  // Core overview endpoint
  fastify.get(
    '/api/overview',
    { preHandler: [ctx.auth.requirePermission('admin.view')] },
    async () => {
      const mem = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const modules = ctx.moduleLoader.listModules();

      return {
        bot: {
          ready: ctx.client.isReady(),
          tag: ctx.client.user?.tag ?? null,
          avatarUrl: ctx.client.user?.displayAvatarURL() ?? null,
          pingMs: ctx.client.ws.ping >= 0 ? Math.round(ctx.client.ws.ping) : null,
          guildsCount: ctx.client.guilds.cache.size,
          uptimeSec: Math.floor(process.uptime()),
          configured: ctx.config.isDiscordConfigured,
        },
        system: {
          platform: os.platform(),
          arch: os.arch(),
          nodeVersion: process.version,
          processRssMb: Math.round(mem.rss / 1024 / 1024),
          hostTotalMemMb: Math.round(totalMem / 1024 / 1024),
          hostUsedMemMb: Math.round((totalMem - freeMem) / 1024 / 1024),
          loadAvg1m: Number(os.loadavg()[0].toFixed(2)),
        },
        modules: {
          total: modules.length,
          enabled: modules.filter((m) => m.enabled).length,
          list: modules,
        },
        recentAudit: ctx.audit.listRecent({ limit: 8 }),
      };
    },
  );

  // Module management endpoints
  fastify.get(
    '/api/modules',
    { preHandler: [ctx.auth.requirePermission('admin.view')] },
    async () => {
      return { modules: ctx.moduleLoader.listModules() };
    },
  );

  fastify.patch<{ Params: { id: string } }>(
    '/api/modules/:id',
    { preHandler: [ctx.auth.requirePermission('admin.modules')] },
    async (request, reply) => {
      const body = z.object({ enabled: z.boolean() }).safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid payload: expected { enabled: boolean }' });
      }

      try {
        const updated = await ctx.moduleLoader.setModuleEnabled(
          request.params.id,
          body.data.enabled,
        );
        ctx.audit.record({
          actorId: request.authUser!.id,
          actorName: request.authUser!.globalName ?? request.authUser!.username,
          source: 'web',
          action: body.data.enabled ? 'module.enable' : 'module.disable',
          target: request.params.id,
        });
        return { module: updated };
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Failed to update module',
        });
      }
    },
  );

  // Live logs & SSE stream
  fastify.get<{ Querystring: { limit?: string } }>(
    '/api/logs',
    { preHandler: [ctx.auth.requirePermission('admin.view')] },
    async (request) => {
      const limit = Math.min(Math.max(Number(request.query.limit ?? 120), 1), 500);
      return { logs: ctx.logger.getRecent(limit) };
    },
  );

  fastify.get(
    '/api/logs/stream',
    { preHandler: [ctx.auth.requirePermission('admin.view')] },
    async (request, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const unsubscribe = ctx.logger.subscribe((entry) => {
        reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        reply.raw.write(': keepalive\n\n');
      }, 20000);

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      return reply;
    },
  );

  // Register all module-scoped routes under /api/modules/<id>/...
  await ctx.moduleLoader.registerAllRoutes(fastify);

  // Serve built React SPA if present
  const webDistCandidates = [
    resolve(__dirname, '../../../web/dist'),
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), '../web/dist'),
  ];
  const webDistPath = webDistCandidates.find((p) => existsSync(join(p, 'index.html')));

  if (webDistPath) {
    await fastify.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      wildcard: false,
    });

    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'API endpoint not found' });
      }
      return reply.sendFile('index.html');
    });
    ctx.logger.info('web', `Serving Admin Web-Page SPA from ${webDistPath}`);
  } else {
    ctx.logger.warn(
      'web',
      'apps/web/dist not found; run "npm run build" or use Vite dev server for the UI.',
    );
  }

  return fastify;
}
