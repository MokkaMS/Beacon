import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/core/database.js';
import { Logger } from '../src/core/logger.js';
import { PermissionService } from '../src/core/permission-service.js';

test('PermissionService enforces bot owners, user rules, role rules, and guild scoping', () => {
  const config = loadConfig({ BOT_OWNER_IDS: '999999999999999999' });
  const db = new AppDatabase(':memory:', new Logger(20));

  try {
    const perms = new PermissionService(db, config);
    perms.registerPermissions(
      [{ key: 'minecraft.manage', label: 'Manage MC', description: 'Manage MC servers' }],
      'minecraft',
    );

    // Owner always has permission
    assert.equal(perms.hasPermission('999999999999999999', 'admin.permissions'), true);
    assert.equal(perms.canAccessDashboard('999999999999999999'), true);

    // Regular user starts with no permissions
    assert.equal(perms.hasPermission('111111111111111111', 'minecraft.manage'), false);
    assert.equal(perms.canAccessDashboard('111111111111111111'), false);

    // Grant user permission in guild A only
    perms.upsertUserPermission({
      guildId: 'guild-a',
      userId: '111111111111111111',
      usernameCache: 'alice',
      permissions: ['minecraft.manage'],
      isAdmin: false,
    });

    assert.equal(
      perms.hasPermission('111111111111111111', 'minecraft.manage', { guildId: 'guild-a' }),
      true,
    );
    assert.equal(
      perms.hasPermission('111111111111111111', 'minecraft.manage', { guildId: 'guild-b' }),
      false,
    );
    assert.equal(perms.canAccessDashboard('111111111111111111'), true);

    // Grant role permission in guild B
    perms.upsertRolePermission({
      guildId: 'guild-b',
      roleId: 'role-mod',
      roleNameCache: 'Moderator',
      permissions: ['admin.servers'],
      isAdmin: false,
    });

    assert.equal(
      perms.hasPermission('222222222222222222', 'admin.servers', {
        guildId: 'guild-b',
        roleIds: ['role-mod'],
      }),
      true,
    );
    assert.equal(
      perms.hasPermission('222222222222222222', 'admin.permissions', {
        guildId: 'guild-b',
        roleIds: ['role-mod'],
      }),
      false,
    );

    // Delete user rule revokes access
    assert.equal(perms.deleteUserPermission('guild-a', '111111111111111111'), true);
    assert.equal(
      perms.hasPermission('111111111111111111', 'minecraft.manage', { guildId: 'guild-a' }),
      false,
    );
  } finally {
    db.close();
  }
});
