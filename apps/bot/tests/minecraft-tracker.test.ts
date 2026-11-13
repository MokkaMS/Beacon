import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { createAuthHelpers } from '../src/api/auth.js';
import { AuditService } from '../src/core/audit-service.js';
import { createDiscordClient } from '../src/core/bot-core.js';
import { AppDatabase } from '../src/core/database.js';
import { Logger } from '../src/core/logger.js';
import { ModuleLoader } from '../src/core/module-loader.js';
import { PermissionService } from '../src/core/permission-service.js';
import type { ModuleContext } from '../src/core/types.js';
import { minecraftMigrations } from '../src/modules/minecraft/migrations.js';
import {
  MinecraftMonitorService,
  type McPingResult,
} from '../src/modules/minecraft/monitor-service.js';

test('MinecraftMonitorService tracks 24/7 checks, incidents, and player session playtime history', () => {
  const config = loadConfig();
  const logger = new Logger(50);
  const db = new AppDatabase(':memory:', logger);
  db.runMigrations('module:minecraft', minecraftMigrations);

  const client = createDiscordClient();
  let ctx!: ModuleContext;
  ctx = {
    config,
    db,
    logger,
    client,
    permissions: new PermissionService(db, config),
    audit: new AuditService(db),
    moduleLoader: new ModuleLoader(),
    auth: createAuthHelpers(() => ctx),
  };

  try {
    const monitor = new MinecraftMonitorService(ctx);
    const created = monitor.createServer({
      name: 'Homelab Survival',
      host: '10.0.0.50',
      port: 25565,
      edition: 'java',
    });

    // Check 1: Server online with Steve & Alex
    const check1: McPingResult = {
      online: true,
      latencyMs: 14,
      playerCount: 2,
      maxPlayers: 20,
      players: [
        { name: 'Steve', id: 'uuid-steve' },
        { name: 'Alex', id: 'uuid-alex' },
      ],
      version: 'Paper 1.21.4',
      motd: 'Welcome to Homelab!',
      favicon: null,
    };

    const out1 = monitor.processCheckResult(
      monitor.getServer(created.id)!,
      check1,
      '2026-11-13 10:00:00',
    );
    assert.deepEqual(out1.joined.sort(), ['Alex', 'Steve']);
    assert.deepEqual(out1.left, []);

    // Check 2 (10 minutes later): Alex left, Steve still online
    const check2: McPingResult = {
      ...check1,
      latencyMs: 18,
      playerCount: 1,
      players: [{ name: 'Steve', id: 'uuid-steve' }],
    };

    const out2 = monitor.processCheckResult(
      monitor.getServer(created.id)!,
      check2,
      '2026-11-13 10:10:00',
    );
    assert.deepEqual(out2.joined, []);
    assert.deepEqual(out2.left, ['Alex']);

    // Check 3 (5 minutes later): Server goes offline -> closes Steve's session (15 mins = 900s)
    const check3: McPingResult = {
      online: false,
      latencyMs: null,
      playerCount: 0,
      maxPlayers: 0,
      players: [],
      version: null,
      motd: null,
      favicon: null,
      errorMessage: 'ECONNREFUSED',
    };

    const out3 = monitor.processCheckResult(
      monitor.getServer(created.id)!,
      check3,
      '2026-11-13 10:15:00',
    );
    assert.equal(out3.statusChanged, true);
    assert.deepEqual(out3.left, ['Steve']);

    const alexDetail = monitor.getPlayerDetail('Alex')!;
    assert.equal(alexDetail.player.totalPlaytimeSeconds, 600);
    assert.equal(alexDetail.player.sessionCount, 1);

    const steveDetail = monitor.getPlayerDetail('Steve')!;
    assert.equal(steveDetail.player.totalPlaytimeSeconds, 900);
    assert.equal(steveDetail.player.sessionCount, 1);

    const history = monitor.getServerHistory(created.id, 24);
    assert.equal(history.points.length, 3);
    assert.equal(history.summary.peakPlayers, 2);
    assert.equal(history.incidents.length, 1);
    assert.equal(history.incidents[0].type, 'offline');
  } finally {
    client.destroy();
    db.close();
  }
});
