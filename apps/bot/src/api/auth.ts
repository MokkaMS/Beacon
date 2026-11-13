import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import type { AppConfig } from '../config.js';
import type {
  AuthGuardHelpers,
  AuthenticatedUser,
  ModuleContext,
} from '../core/types.js';

export const SESSION_COOKIE = 'beacon_session';
const OAUTH_STATE_COOKIE = 'beacon_oauth_state';

interface DiscordUserPayload {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

interface DiscordGuildSummary {
  id: string;
  name: string;
  permissions: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(
  user: AuthenticatedUser,
  secret: string,
): Promise<string> {
  return new SignJWT({
    sub: user.id,
    username: user.username,
    globalName: user.globalName,
    avatarUrl: user.avatarUrl,
    isBotOwner: user.isBotOwner,
    isDevBypass: Boolean(user.isDevBypass),
    guildIds: user.guildIds,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecretKey(secret));
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<AuthenticatedUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(secret));
    if (!payload.sub || typeof payload.username !== 'string') return null;
    return {
      id: payload.sub,
      username: payload.username,
      globalName: typeof payload.globalName === 'string' ? payload.globalName : null,
      avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : '',
      isBotOwner: Boolean(payload.isBotOwner),
      isDevBypass: Boolean(payload.isDevBypass),
      guildIds: Array.isArray(payload.guildIds)
        ? payload.guildIds.filter((x): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

export function collectUserGuildRoles(
  ctx: ModuleContext,
  userId: string,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!ctx.client.isReady()) return map;

  for (const guild of ctx.client.guilds.cache.values()) {
    const member = guild.members.cache.get(userId);
    if (member) {
      map.set(guild.id, Array.from(member.roles.cache.keys()));
    }
  }
  return map;
}

export function createAuthHelpers(getCtx: () => ModuleContext): AuthGuardHelpers {
  const resolveRequestUser = async (
    request: FastifyRequest,
  ): Promise<AuthenticatedUser | null> => {
    if (request.authUser) return request.authUser;
    const ctx = getCtx();
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token) return null;

    const user = await verifySessionToken(token, ctx.config.sessionSecret);
    if (!user) return null;

    // Re-evaluate owner status against live config
    user.isBotOwner = user.isDevBypass || ctx.permissions.isBotOwner(user.id);
    request.authUser = user;
    return user;
  };

  const requireAuth = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const user = await resolveRequestUser(request);
    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
  };

  const requirePermission = (
    permissionKey: string,
    getGuildId?: (request: FastifyRequest) => string | undefined,
  ) => {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const user = await resolveRequestUser(request);
      if (!user) {
        return reply.code(401).send({ error: 'Authentication required' });
      }
      if (user.isBotOwner) return;

      const ctx = getCtx();
      const guildId = getGuildId ? getGuildId(request) : undefined;
      const guildRolesMap = collectUserGuildRoles(ctx, user.id);
      const roleIds = guildId ? guildRolesMap.get(guildId) ?? [] : [];

      const allowed = ctx.permissions.hasPermission(user.id, permissionKey, {
        guildId,
        roleIds,
      });

      if (!allowed) {
        return reply.code(403).send({
          error: `Missing required permission: ${permissionKey}`,
        });
      }
    };
  };

  return { requireAuth, requirePermission };
}

export function registerAuthRoutes(
  fastify: FastifyInstance,
  ctx: ModuleContext,
): void {
  const isHttps = ctx.config.publicUrl.startsWith('https://');

  const getBotInviteUrl = (config: AppConfig) => {
    if (!config.discordClientId) return null;
    const params = new URLSearchParams({
      client_id: config.discordClientId,
      permissions: '8',
      scope: 'bot applications.commands',
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  };

  fastify.get('/api/auth/status', async (request) => {
    const token = request.cookies?.[SESSION_COOKIE];
    const user = token
      ? await verifySessionToken(token, ctx.config.sessionSecret)
      : null;

    if (!user) {
      return {
        authenticated: false,
        user: null,
        effectivePermissions: null,
        oauthConfigured: ctx.config.isOAuthConfigured,
        devBypassAllowed: ctx.config.devBypassAuth && ctx.config.nodeEnv !== 'production',
        botInviteUrl: getBotInviteUrl(ctx.config),
      };
    }

    user.isBotOwner = user.isDevBypass || ctx.permissions.isBotOwner(user.id);
    const guildRolesMap = collectUserGuildRoles(ctx, user.id);
    const effective = user.isDevBypass
      ? {
          isOwner: true,
          isGlobalAdmin: true,
          permissions: ['*', ...ctx.permissions.listDefinitions().map((d) => d.key)],
          adminGuildIds: ['*'],
        }
      : ctx.permissions.getEffectivePermissions(user.id, guildRolesMap);

    return {
      authenticated: true,
      user,
      effectivePermissions: effective,
      oauthConfigured: ctx.config.isOAuthConfigured,
      devBypassAllowed: ctx.config.devBypassAuth && ctx.config.nodeEnv !== 'production',
      botInviteUrl: getBotInviteUrl(ctx.config),
    };
  });

  fastify.get('/api/auth/login', async (_request, reply) => {
    if (!ctx.config.isOAuthConfigured) {
      return reply.code(503).send({
        error: 'Discord OAuth2 is not configured. Check DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and DISCORD_REDIRECT_URI.',
      });
    }

    const state = randomBytes(24).toString('hex');
    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 600,
    });

    const params = new URLSearchParams({
      client_id: ctx.config.discordClientId,
      redirect_uri: ctx.config.discordRedirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state,
    });

    return reply.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
  });

  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>('/api/auth/callback', async (request, reply) => {
    const { code, state, error } = request.query;
    const expectedState = request.cookies?.[OAUTH_STATE_COOKIE];
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    if (error || !code || !state || !expectedState || state !== expectedState) {
      return reply.redirect(`${ctx.config.publicUrl}/?error=oauth_failed`);
    }

    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: ctx.config.discordClientId,
          client_secret: ctx.config.discordClientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: ctx.config.discordRedirectUri,
        }),
      });

      if (!tokenRes.ok) {
        ctx.logger.warn('auth', `Discord token exchange failed with ${tokenRes.status}`);
        return reply.redirect(`${ctx.config.publicUrl}/?error=oauth_token_failed`);
      }

      const tokenJson = (await tokenRes.json()) as { access_token: string };
      const authHeader = { Authorization: `Bearer ${tokenJson.access_token}` };

      const [userRes, guildsRes] = await Promise.all([
        fetch('https://discord.com/api/users/@me', { headers: authHeader }),
        fetch('https://discord.com/api/users/@me/guilds', { headers: authHeader }),
      ]);

      if (!userRes.ok) {
        return reply.redirect(`${ctx.config.publicUrl}/?error=oauth_user_failed`);
      }

      const discordUser = (await userRes.json()) as DiscordUserPayload;
      const discordGuilds = guildsRes.ok
        ? ((await guildsRes.json()) as DiscordGuildSummary[])
        : [];

      const guildRolesMap = collectUserGuildRoles(ctx, discordUser.id);
      const canAccess = ctx.permissions.canAccessDashboard(discordUser.id, guildRolesMap);

      if (!canAccess) {
        ctx.logger.warn(
          'auth',
          `Denied dashboard login for Discord user ${discordUser.username} (${discordUser.id})`,
        );
        return reply.redirect(`${ctx.config.publicUrl}/?error=access_denied`);
      }

      const avatarUrl = discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(discordUser.id) % 5n)}.png`;

      const sessionUser: AuthenticatedUser = {
        id: discordUser.id,
        username: discordUser.username,
        globalName: discordUser.global_name,
        avatarUrl,
        isBotOwner: ctx.permissions.isBotOwner(discordUser.id),
        guildIds: discordGuilds.map((g) => g.id),
      };

      const jwt = await signSessionToken(sessionUser, ctx.config.sessionSecret);
      reply.setCookie(SESSION_COOKIE, jwt, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });

      ctx.audit.record({
        actorId: sessionUser.id,
        actorName: sessionUser.globalName ?? sessionUser.username,
        source: 'web',
        action: 'auth.login',
      });

      return reply.redirect(`${ctx.config.publicUrl}/`);
    } catch (err) {
      ctx.logger.error('auth', 'OAuth2 callback error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return reply.redirect(`${ctx.config.publicUrl}/?error=oauth_exception`);
    }
  });

  fastify.post('/api/auth/dev-login', async (_request, reply) => {
    if (!(ctx.config.devBypassAuth && ctx.config.nodeEnv !== 'production')) {
      return reply.code(403).send({ error: 'Dev bypass login is disabled' });
    }

    const devUser: AuthenticatedUser = {
      id: ctx.config.botOwnerIds[0] ?? 'dev-admin',
      username: 'dev-admin',
      globalName: 'Local Dev Admin',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
      isBotOwner: true,
      isDevBypass: true,
      guildIds: [],
    };

    const jwt = await signSessionToken(devUser, ctx.config.sessionSecret);
    reply.setCookie(SESSION_COOKIE, jwt, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    return { ok: true, user: devUser };
  });

  fastify.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
