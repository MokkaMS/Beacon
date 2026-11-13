import type { AppConfig } from '../config.js';
import type { AppDatabase } from './database.js';
import type { PermissionDefinition } from './types.js';

export interface UserPermissionRecord {
  id: number;
  guildId: string;
  userId: string;
  usernameCache: string;
  permissions: string[];
  isAdmin: boolean;
  note: string;
  updatedAt: string;
}

export interface RolePermissionRecord {
  id: number;
  guildId: string;
  roleId: string;
  roleNameCache: string;
  permissions: string[];
  isAdmin: boolean;
  updatedAt: string;
}

interface RawUserPermissionRow {
  id: number;
  guild_id: string;
  user_id: string;
  username_cache: string;
  permissions_json: string;
  is_admin: number;
  note: string;
  updated_at: string;
}

interface RawRolePermissionRow {
  id: number;
  guild_id: string;
  role_id: string;
  role_name_cache: string;
  permissions_json: string;
  is_admin: number;
  updated_at: string;
}

export const CORE_PERMISSIONS: PermissionDefinition[] = [
  {
    key: 'admin.view',
    label: 'Access Admin Dashboard',
    description: 'Allows logging into the Admin Web-Page and viewing overview metrics.',
    moduleId: 'core',
  },
  {
    key: 'admin.permissions',
    label: 'Manage Permissions',
    description: 'Allows assigning and revoking Discord user and role permissions.',
    moduleId: 'core',
  },
  {
    key: 'admin.servers',
    label: 'Manage Discord Servers',
    description: 'Allows managing channels, roles, members, and announcements on Discord servers.',
    moduleId: 'core',
  },
  {
    key: 'admin.modules',
    label: 'Manage Modules',
    description: 'Allows enabling/disabling bot modules globally or per server.',
    moduleId: 'core',
  },
  {
    key: 'admin.settings',
    label: 'Manage Bot Settings',
    description: 'Allows changing bot presence, syncing slash commands, and viewing audit logs.',
    moduleId: 'core',
  },
];

export class PermissionService {
  private readonly definitions = new Map<string, PermissionDefinition>();

  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig,
  ) {
    this.registerPermissions(CORE_PERMISSIONS);
  }

  registerPermissions(defs: PermissionDefinition[], moduleId?: string): void {
    for (const def of defs) {
      this.definitions.set(def.key, {
        ...def,
        moduleId: def.moduleId ?? moduleId ?? 'core',
      });
    }
  }

  listDefinitions(): PermissionDefinition[] {
    return Array.from(this.definitions.values());
  }

  isBotOwner(userId: string): boolean {
    return this.config.botOwnerIds.includes(userId);
  }

  hasPermission(
    userId: string,
    permissionKey: string,
    context: { guildId?: string; roleIds?: string[]; isDiscordGuildAdmin?: boolean } = {},
  ): boolean {
    if (this.isBotOwner(userId)) {
      return true;
    }

    // Check global ('*') and guild-specific user rules
    const scopes = context.guildId ? ['*', context.guildId] : ['*'];
    const placeholders = scopes.map(() => '?').join(', ');
    const userRows = this.db.all<RawUserPermissionRow>(
      `SELECT * FROM user_permissions WHERE user_id = ? AND guild_id IN (${placeholders})`,
      userId,
      ...scopes,
    );

    for (const row of userRows) {
      if (row.is_admin === 1) return true;
      const perms = parseStringArray(row.permissions_json);
      if (perms.includes('*') || perms.includes(permissionKey)) {
        return true;
      }
    }

    // Check role-based rules for the given guild
    if (context.guildId && context.roleIds && context.roleIds.length > 0) {
      const rolePlaceholders = context.roleIds.map(() => '?').join(', ');
      const roleRows = this.db.all<RawRolePermissionRow>(
        `SELECT * FROM role_permissions WHERE guild_id = ? AND role_id IN (${rolePlaceholders})`,
        context.guildId,
        ...context.roleIds,
      );

      for (const row of roleRows) {
        if (row.is_admin === 1) return true;
        const perms = parseStringArray(row.permissions_json);
        if (perms.includes('*') || perms.includes(permissionKey)) {
          return true;
        }
      }
    }

    // Optional Discord native guild administrator fallback for guild-scoped actions
    if (context.isDiscordGuildAdmin && context.guildId) {
      const allowGuildAdmin = this.db.getSetting<boolean>('allowGuildAdminBypass', true);
      if (allowGuildAdmin && !permissionKey.startsWith('admin.settings')) {
        return true;
      }
    }

    return false;
  }

  getEffectivePermissions(
    userId: string,
    guildRolesMap: Map<string, string[]> = new Map(),
  ): { isOwner: boolean; isGlobalAdmin: boolean; permissions: string[]; adminGuildIds: string[] } {
    if (this.isBotOwner(userId)) {
      return {
        isOwner: true,
        isGlobalAdmin: true,
        permissions: ['*', ...Array.from(this.definitions.keys())],
        adminGuildIds: ['*'],
      };
    }

    const permSet = new Set<string>();
    const adminGuildIds = new Set<string>();
    let isGlobalAdmin = false;

    const userRows = this.db.all<RawUserPermissionRow>(
      'SELECT * FROM user_permissions WHERE user_id = ?',
      userId,
    );

    for (const row of userRows) {
      if (row.is_admin === 1) {
        if (row.guild_id === '*') isGlobalAdmin = true;
        adminGuildIds.add(row.guild_id);
      }
      for (const p of parseStringArray(row.permissions_json)) {
        permSet.add(p);
      }
    }

    for (const [guildId, roleIds] of guildRolesMap.entries()) {
      if (roleIds.length === 0) continue;
      const placeholders = roleIds.map(() => '?').join(', ');
      const roleRows = this.db.all<RawRolePermissionRow>(
        `SELECT * FROM role_permissions WHERE guild_id = ? AND role_id IN (${placeholders})`,
        guildId,
        ...roleIds,
      );
      for (const row of roleRows) {
        if (row.is_admin === 1) adminGuildIds.add(guildId);
        for (const p of parseStringArray(row.permissions_json)) {
          permSet.add(p);
        }
      }
    }

    return {
      isOwner: false,
      isGlobalAdmin,
      permissions: Array.from(permSet),
      adminGuildIds: Array.from(adminGuildIds),
    };
  }

  canAccessDashboard(
    userId: string,
    guildRolesMap: Map<string, string[]> = new Map(),
  ): boolean {
    if (this.isBotOwner(userId)) return true;
    const effective = this.getEffectivePermissions(userId, guildRolesMap);
    if (effective.isGlobalAdmin || effective.adminGuildIds.length > 0) return true;
    return effective.permissions.length > 0;
  }

  listUserPermissions(guildId?: string): UserPermissionRecord[] {
    const rows = guildId
      ? this.db.all<RawUserPermissionRow>(
          'SELECT * FROM user_permissions WHERE guild_id = ? ORDER BY updated_at DESC',
          guildId,
        )
      : this.db.all<RawUserPermissionRow>(
          'SELECT * FROM user_permissions ORDER BY guild_id ASC, updated_at DESC',
        );

    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      userId: r.user_id,
      usernameCache: r.username_cache,
      permissions: parseStringArray(r.permissions_json),
      isAdmin: r.is_admin === 1,
      note: r.note,
      updatedAt: r.updated_at,
    }));
  }

  upsertUserPermission(input: {
    guildId: string;
    userId: string;
    usernameCache?: string;
    permissions: string[];
    isAdmin: boolean;
    note?: string;
  }): UserPermissionRecord {
    const uniquePerms = Array.from(new Set(input.permissions));
    this.db.run(
      `INSERT INTO user_permissions (guild_id, user_id, username_cache, permissions_json, is_admin, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         username_cache = COALESCE(NULLIF(excluded.username_cache, ''), user_permissions.username_cache),
         permissions_json = excluded.permissions_json,
         is_admin = excluded.is_admin,
         note = excluded.note,
         updated_at = datetime('now')`,
      input.guildId,
      input.userId,
      input.usernameCache ?? '',
      JSON.stringify(uniquePerms),
      input.isAdmin ? 1 : 0,
      input.note ?? '',
    );

    const row = this.db.get<RawUserPermissionRow>(
      'SELECT * FROM user_permissions WHERE guild_id = ? AND user_id = ?',
      input.guildId,
      input.userId,
    )!;

    return {
      id: row.id,
      guildId: row.guild_id,
      userId: row.user_id,
      usernameCache: row.username_cache,
      permissions: parseStringArray(row.permissions_json),
      isAdmin: row.is_admin === 1,
      note: row.note,
      updatedAt: row.updated_at,
    };
  }

  deleteUserPermission(guildId: string, userId: string): boolean {
    const res = this.db.run(
      'DELETE FROM user_permissions WHERE guild_id = ? AND user_id = ?',
      guildId,
      userId,
    );
    return Number(res.changes) > 0;
  }

  listRolePermissions(guildId?: string): RolePermissionRecord[] {
    const rows = guildId
      ? this.db.all<RawRolePermissionRow>(
          'SELECT * FROM role_permissions WHERE guild_id = ? ORDER BY updated_at DESC',
          guildId,
        )
      : this.db.all<RawRolePermissionRow>(
          'SELECT * FROM role_permissions ORDER BY guild_id ASC, updated_at DESC',
        );

    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      roleId: r.role_id,
      roleNameCache: r.role_name_cache,
      permissions: parseStringArray(r.permissions_json),
      isAdmin: r.is_admin === 1,
      updatedAt: r.updated_at,
    }));
  }

  upsertRolePermission(input: {
    guildId: string;
    roleId: string;
    roleNameCache?: string;
    permissions: string[];
    isAdmin: boolean;
  }): RolePermissionRecord {
    const uniquePerms = Array.from(new Set(input.permissions));
    this.db.run(
      `INSERT INTO role_permissions (guild_id, role_id, role_name_cache, permissions_json, is_admin, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(guild_id, role_id) DO UPDATE SET
         role_name_cache = COALESCE(NULLIF(excluded.role_name_cache, ''), role_permissions.role_name_cache),
         permissions_json = excluded.permissions_json,
         is_admin = excluded.is_admin,
         updated_at = datetime('now')`,
      input.guildId,
      input.roleId,
      input.roleNameCache ?? '',
      JSON.stringify(uniquePerms),
      input.isAdmin ? 1 : 0,
    );

    const row = this.db.get<RawRolePermissionRow>(
      'SELECT * FROM role_permissions WHERE guild_id = ? AND role_id = ?',
      input.guildId,
      input.roleId,
    )!;

    return {
      id: row.id,
      guildId: row.guild_id,
      roleId: row.role_id,
      roleNameCache: row.role_name_cache,
      permissions: parseStringArray(row.permissions_json),
      isAdmin: row.is_admin === 1,
      updatedAt: row.updated_at,
    };
  }

  deleteRolePermission(guildId: string, roleId: string): boolean {
    const res = this.db.run(
      'DELETE FROM role_permissions WHERE guild_id = ? AND role_id = ?',
      guildId,
      roleId,
    );
    return Number(res.changes) > 0;
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
