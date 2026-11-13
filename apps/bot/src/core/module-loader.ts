import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type {
  BotModule,
  LoadedModuleInfo,
  ModuleContext,
  SlashCommandDefinition,
} from './types.js';

interface RegisteredModule {
  module: BotModule;
  enabled: boolean;
  loaded: boolean;
}

export class ModuleLoader {
  private readonly modules = new Map<string, RegisteredModule>();
  private readonly commandIndex = new Map<
    string,
    { moduleId: string; command: SlashCommandDefinition }
  >();
  private context?: ModuleContext;

  setContext(ctx: ModuleContext): void {
    this.context = ctx;
  }

  /**
   * Auto-discovers modules inside `modulesDir` (skipping folders starting with `_`).
   * Supports both `.ts` (dev via tsx) and `.js` (built dist).
   */
  async discoverModules(modulesDir: string): Promise<BotModule[]> {
    const absDir = resolve(modulesDir);
    if (!existsSync(absDir)) return [];

    const entries = readdirSync(absDir, { withFileTypes: true });
    const discovered: BotModule[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

      const tsPath = join(absDir, entry.name, 'index.ts');
      const jsPath = join(absDir, entry.name, 'index.js');
      const target = existsSync(tsPath) ? tsPath : existsSync(jsPath) ? jsPath : null;
      if (!target) continue;

      const mod = await import(pathToFileURL(target).href);
      const botModule: BotModule | undefined = mod.default ?? mod.module;
      if (!botModule || !botModule.id) {
        this.context?.logger.warn(
          'modules',
          `Skipping directory "${entry.name}": no default BotModule export found`,
        );
        continue;
      }
      discovered.push(botModule);
    }

    // Load core/admin module first, then alphabetical
    discovered.sort((a, b) => {
      if (a.ui?.core && !b.ui?.core) return -1;
      if (!a.ui?.core && b.ui?.core) return 1;
      return a.id.localeCompare(b.id);
    });

    return discovered;
  }

  async registerModule(botModule: BotModule): Promise<void> {
    if (!this.context) {
      throw new Error('ModuleLoader context must be set before registering modules');
    }

    if (this.modules.has(botModule.id)) {
      throw new Error(`Duplicate module id: ${botModule.id}`);
    }

    // Run module database migrations if provided
    if (botModule.migrations && botModule.migrations.length > 0) {
      this.context.db.runMigrations(`module:${botModule.id}`, botModule.migrations);
    }

    // Register module permissions
    if (botModule.permissions && botModule.permissions.length > 0) {
      this.context.permissions.registerPermissions(botModule.permissions, botModule.id);
    }

    // Determine persisted enabled state
    const row = this.context.db.get<{ enabled: number }>(
      'SELECT enabled FROM modules_state WHERE module_id = ?',
      botModule.id,
    );

    const enabled = botModule.ui?.core
      ? true
      : row
        ? row.enabled === 1
        : botModule.defaultEnabled;

    if (!row) {
      this.context.db.run(
        'INSERT INTO modules_state (module_id, enabled) VALUES (?, ?)',
        botModule.id,
        enabled ? 1 : 0,
      );
    }

    const record: RegisteredModule = {
      module: botModule,
      enabled,
      loaded: false,
    };
    this.modules.set(botModule.id, record);

    // Index slash commands
    for (const cmd of botModule.commands ?? []) {
      const cmdName = cmd.data.name;
      if (this.commandIndex.has(cmdName)) {
        throw new Error(
          `Slash command "/${cmdName}" in module "${botModule.id}" conflicts with another module`,
        );
      }
      this.commandIndex.set(cmdName, { moduleId: botModule.id, command: cmd });
    }

    // Bind Discord client events (guarded by module enabled & per-guild enabled)
    for (const evt of botModule.events ?? []) {
      const handler = async (...args: unknown[]) => {
        const state = this.modules.get(botModule.id);
        if (!state?.enabled) return;
        try {
          await (evt.execute as (...a: unknown[]) => unknown)(this.context!, ...args);
        } catch (error) {
          this.context?.logger.error(
            `module:${botModule.id}`,
            `Unhandled error in event "${String(evt.event)}"`,
            { error: error instanceof Error ? error.message : String(error) },
          );
        }
      };

      if (evt.once) {
        this.context.client.once(evt.event, handler);
      } else {
        this.context.client.on(evt.event, handler);
      }
    }

    if (enabled) {
      await this.activateModule(botModule.id);
    }

    this.context.logger.info(
      'modules',
      `Registered module "${botModule.id}" v${botModule.version} (${enabled ? 'enabled' : 'disabled'})`,
    );
  }

  async registerAllRoutes(fastify: FastifyInstance): Promise<void> {
    if (!this.context) return;
    for (const { module } of this.modules.values()) {
      if (!module.registerRoutes) continue;
      await fastify.register(
        async (scopedFastify) => {
          // Guard non-core module routes when module is globally disabled
          if (!module.ui?.core) {
            scopedFastify.addHook('onRequest', async (_req, reply) => {
              if (!this.isModuleEnabled(module.id)) {
                return reply.code(503).send({
                  error: `Module "${module.name}" is currently disabled.`,
                });
              }
            });
          }
          await module.registerRoutes!(scopedFastify, this.context!);
        },
        { prefix: `/api/modules/${module.id}` },
      );
    }
  }

  private async activateModule(moduleId: string): Promise<void> {
    const entry = this.modules.get(moduleId);
    if (!entry || entry.loaded || !this.context) return;
    if (entry.module.onLoad) {
      await entry.module.onLoad(this.context);
    }
    entry.loaded = true;
  }

  private async deactivateModule(moduleId: string): Promise<void> {
    const entry = this.modules.get(moduleId);
    if (!entry || !entry.loaded || !this.context) return;
    if (entry.module.onUnload) {
      await entry.module.onUnload(this.context);
    }
    entry.loaded = false;
  }

  async setModuleEnabled(moduleId: string, enabled: boolean): Promise<LoadedModuleInfo> {
    const entry = this.modules.get(moduleId);
    if (!entry) {
      throw new Error(`Module "${moduleId}" not found`);
    }
    if (entry.module.ui?.core && !enabled) {
      throw new Error(`Core module "${moduleId}" cannot be disabled`);
    }

    entry.enabled = enabled;
    this.context?.db.run(
      `INSERT INTO modules_state (module_id, enabled, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(module_id) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`,
      moduleId,
      enabled ? 1 : 0,
    );

    if (enabled) {
      await this.activateModule(moduleId);
    } else {
      await this.deactivateModule(moduleId);
    }

    return this.getModuleInfo(moduleId)!;
  }

  isModuleEnabled(moduleId: string, guildId?: string | null): boolean {
    const entry = this.modules.get(moduleId);
    if (!entry || !entry.enabled) return false;
    if (!guildId || entry.module.ui?.core) return true;

    const row = this.context?.db.get<{ disabled_modules: string }>(
      'SELECT disabled_modules FROM guild_settings WHERE guild_id = ?',
      guildId,
    );
    if (!row) return true;
    try {
      const disabled = JSON.parse(row.disabled_modules) as string[];
      return !disabled.includes(moduleId);
    } catch {
      return true;
    }
  }

  setGuildModuleEnabled(guildId: string, moduleId: string, enabled: boolean): void {
    const entry = this.modules.get(moduleId);
    if (!entry) throw new Error(`Module "${moduleId}" not found`);
    if (entry.module.ui?.core && !enabled) {
      throw new Error(`Core module "${moduleId}" cannot be disabled per server`);
    }

    const row = this.context?.db.get<{ disabled_modules: string }>(
      'SELECT disabled_modules FROM guild_settings WHERE guild_id = ?',
      guildId,
    );
    let disabled: string[] = [];
    if (row) {
      try {
        disabled = JSON.parse(row.disabled_modules) as string[];
      } catch {
        disabled = [];
      }
    }

    const set = new Set(disabled);
    if (enabled) {
      set.delete(moduleId);
    } else {
      set.add(moduleId);
    }

    this.context?.db.run(
      `INSERT INTO guild_settings (guild_id, disabled_modules, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(guild_id) DO UPDATE SET disabled_modules = excluded.disabled_modules, updated_at = datetime('now')`,
      guildId,
      JSON.stringify(Array.from(set)),
    );
  }

  getCommand(commandName: string) {
    return this.commandIndex.get(commandName);
  }

  getAllSlashCommandJSON() {
    const list: ReturnType<SlashCommandDefinition['data']['toJSON']>[] = [];
    for (const { moduleId, command } of this.commandIndex.values()) {
      if (this.isModuleEnabled(moduleId)) {
        list.push(command.data.toJSON());
      }
    }
    return list;
  }

  getModuleInfo(moduleId: string): LoadedModuleInfo | undefined {
    const entry = this.modules.get(moduleId);
    if (!entry) return undefined;
    const m = entry.module;
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      version: m.version,
      author: m.author ?? 'Homelab',
      enabled: entry.enabled,
      defaultEnabled: m.defaultEnabled,
      core: Boolean(m.ui?.core),
      ui: m.ui,
      permissions: m.permissions ?? [],
      commands: (m.commands ?? []).map((c) => ({
        name: c.data.name,
        description: c.data.description,
        requiredPermission: c.requiredPermission,
      })),
    };
  }

  listModules(): LoadedModuleInfo[] {
    return Array.from(this.modules.keys())
      .map((id) => this.getModuleInfo(id)!)
      .filter(Boolean);
  }

  async unloadAll(): Promise<void> {
    for (const id of Array.from(this.modules.keys()).reverse()) {
      await this.deactivateModule(id);
    }
  }
}
