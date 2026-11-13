import type {
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from './database.js';
import type { Logger } from './logger.js';
import type { PermissionService } from './permission-service.js';
import type { AuditService } from './audit-service.js';
import type { ModuleLoader } from './module-loader.js';

export type AnySlashCommandBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;

export interface PermissionDefinition {
  /** Unique permission key, e.g. "minecraft.manage" */
  key: string;
  /** Human-readable name */
  label: string;
  /** Short description shown in Admin Web-Page */
  description: string;
  /** Module ID that registered this permission */
  moduleId?: string;
}

export interface SlashCommandDefinition {
  data: AnySlashCommandBuilder;
  /** Optional permission key required in addition to module being enabled */
  requiredPermission?: string;
  /** If true, command only works inside a Discord guild (not DMs) */
  guildOnly?: boolean;
  execute: (
    interaction: ChatInputCommandInteraction,
    ctx: ModuleContext,
  ) => Promise<void>;
}

export interface ModuleEventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  event: K;
  once?: boolean;
  execute: (ctx: ModuleContext, ...args: ClientEvents[K]) => Promise<void> | void;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
  isBotOwner: boolean;
  isDevBypass?: boolean;
  guildIds: string[];
}

export interface AuthGuardHelpers {
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requirePermission: (
    permissionKey: string,
    getGuildId?: (request: FastifyRequest) => string | undefined,
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export interface ModuleContext {
  config: AppConfig;
  db: AppDatabase;
  logger: Logger;
  client: Client;
  permissions: PermissionService;
  audit: AuditService;
  moduleLoader: ModuleLoader;
  auth: AuthGuardHelpers;
}

export interface ModuleRouteRegistrar {
  fastify: FastifyInstance;
  ctx: ModuleContext;
}

export interface ModuleMigration {
  version: number;
  sql: string;
}

export interface ModuleUiMetadata {
  /** Dedicated route slug in the Admin Web-Page (e.g. "/minecraft") */
  navPath?: string;
  navLabel?: string;
  icon?: string;
  /** Whether this module can be toggled on/off */
  core?: boolean;
}

export interface BotModule {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  defaultEnabled: boolean;
  ui?: ModuleUiMetadata;
  permissions?: PermissionDefinition[];
  migrations?: ModuleMigration[];
  commands?: SlashCommandDefinition[];
  events?: ModuleEventHandler[];
  registerRoutes?: (fastify: FastifyInstance, ctx: ModuleContext) => Promise<void> | void;
  onLoad?: (ctx: ModuleContext) => Promise<void> | void;
  onUnload?: (ctx: ModuleContext) => Promise<void> | void;
}

export interface LoadedModuleInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  enabled: boolean;
  defaultEnabled: boolean;
  core: boolean;
  ui?: ModuleUiMetadata;
  permissions: PermissionDefinition[];
  commands: { name: string; description: string; requiredPermission?: string }[];
}
