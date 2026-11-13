import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Load variables from a .env file into process.env if not already set.
 * Searches current working directory and workspace root.
 */
function loadEnvFile(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ];

  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    break;
  }
}

loadEnvFile();

const envSchema = z.object({
  DISCORD_TOKEN: z.string().default(''),
  DISCORD_CLIENT_ID: z.string().default(''),
  DISCORD_CLIENT_SECRET: z.string().default(''),
  BOT_OWNER_IDS: z.string().default(''),
  DISCORD_DEV_GUILD_ID: z.string().default(''),

  PUBLIC_URL: z.string().default('http://localhost:3000'),
  DISCORD_REDIRECT_URI: z.string().default('http://localhost:3000/api/auth/callback'),
  SESSION_SECRET: z
    .string()
    .default('dev-insecure-secret-please-change-in-production-32chars'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DEV_BYPASS_AUTH: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  DATABASE_PATH: z.string().default('./data/bot.db'),
  MC_DEFAULT_POLL_INTERVAL_SEC: z.coerce.number().int().min(10).max(3600).default(60),
  MC_HISTORY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  discordClientSecret: string;
  botOwnerIds: string[];
  devGuildId: string;
  publicUrl: string;
  discordRedirectUri: string;
  sessionSecret: string;
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  devBypassAuth: boolean;
  databasePath: string;
  mcDefaultPollIntervalSec: number;
  mcHistoryRetentionDays: number;
  isDiscordConfigured: boolean;
  isOAuthConfigured: boolean;
}

export function loadConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  const parsed = envSchema.parse({ ...process.env, ...overrides });
  const botOwnerIds = parsed.BOT_OWNER_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return {
    discordToken: parsed.DISCORD_TOKEN.trim(),
    discordClientId: parsed.DISCORD_CLIENT_ID.trim(),
    discordClientSecret: parsed.DISCORD_CLIENT_SECRET.trim(),
    botOwnerIds,
    devGuildId: parsed.DISCORD_DEV_GUILD_ID.trim(),
    publicUrl: parsed.PUBLIC_URL.replace(/\/+$/, ''),
    discordRedirectUri: parsed.DISCORD_REDIRECT_URI.trim(),
    sessionSecret: parsed.SESSION_SECRET,
    port: parsed.PORT,
    host: parsed.HOST,
    nodeEnv: parsed.NODE_ENV,
    devBypassAuth: parsed.DEV_BYPASS_AUTH,
    databasePath: parsed.DATABASE_PATH,
    mcDefaultPollIntervalSec: parsed.MC_DEFAULT_POLL_INTERVAL_SEC,
    mcHistoryRetentionDays: parsed.MC_HISTORY_RETENTION_DAYS,
    isDiscordConfigured: Boolean(parsed.DISCORD_TOKEN.trim() && parsed.DISCORD_CLIENT_ID.trim()),
    isOAuthConfigured: Boolean(
      parsed.DISCORD_CLIENT_ID.trim() &&
        parsed.DISCORD_CLIENT_SECRET.trim() &&
        parsed.DISCORD_REDIRECT_URI.trim(),
    ),
  };
}
