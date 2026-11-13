# Module Development Guide

Every feature in this bot lives under `apps/bot/src/modules/<module-id>/index.ts`.
Folders starting with `_` (such as `_template`) are ignored at runtime.

## Quick Scaffold
```bash
npm run create-module proxmox-alerts
```
This copies `apps/bot/src/modules/_template/index.ts` into `apps/bot/src/modules/proxmox-alerts/index.ts`.

## Module Anatomy (`BotModule`)
```ts
const myModule: BotModule = {
  id: 'my-module',
  name: 'My Module',
  description: 'What this module does',
  version: '1.0.0',
  defaultEnabled: true,

  // 1. Custom permissions (automatically shown in the Admin Web-Page Permissions UI)
  permissions: [
    {
      key: 'my-module.manage',
      label: 'Manage My Module',
      description: 'Allows configuring My Module.',
    },
  ],

  // 2. SQLite migrations (versioned per module namespace)
  migrations: [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS my_items (id INTEGER PRIMARY KEY, name TEXT);`,
    },
  ],

  // 3. Discord Slash Commands (automatically synced & permission-checked)
  commands: [ ... ],

  // 4. Discord Client Events (automatically skipped when module is disabled)
  events: [ ... ],

  // 5. REST API endpoints (auto-mounted at /api/modules/<id>/...)
  registerRoutes: async (fastify, ctx) => { ... },

  // 6. Lifecycle hooks (called on startup or dynamic enable/disable)
  onLoad: async (ctx) => { ... },
  onUnload: async (ctx) => { ... },
};
```

## Runtime Toggle Behavior
- When an admin disables a module in the Admin Web-Page:
  - `onUnload(ctx)` is called immediately (stop timers/pollers here).
  - Slash commands from that module reply with a friendly disabled message.
  - Event handlers from that module are skipped.
  - API routes under `/api/modules/<id>/*` return `503`.
