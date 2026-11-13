# Beacon — Modular Discord Bot & Admin Web-Page (Proxmox Homelab)

A fully modular **TypeScript** Discord bot (`discord.js` v14) paired with an integrated **Admin Web-Page** (Fastify + React + Tailwind CSS) and **24/7 Minecraft Server & Player Monitoring**, packaged for one-command deployment and updates on your **Proxmox Homelab** via **Docker Compose + Cloudflare Tunnel**.

---

## Key Features

### 1. Full Modularity
- Auto-discovered plugin system under `apps/bot/src/modules/<module-id>/`.
- Each module encapsulates its own **Slash Commands**, **Discord Events**, **SQLite Migrations**, **Permissions**, **REST API Routes**, and **Lifecycle Hooks** (`onLoad` / `onUnload`).
- Toggle modules on/off globally or per Discord server directly from the Admin Web-Page without restarting the container.
- Scaffold a new module in seconds:
  ```bash
  npm run create-module my-new-module
  ```

### 2. Admin Web-Page (Accessible Worldwide via Cloudflare Tunnel)
- **Discord OAuth2 Login**: Sign in with Discord; access is strictly gated by `BOT_OWNER_IDS` and your configured permission rules.
- **Discord User & Role Permission Management**: Grant/revoke fine-grained permissions (`admin.*`, `minecraft.*`, or future module permissions) per Discord User or Discord Role, globally or per server.
- **Server Management**: Browse connected Discord servers, inspect channels, send rich Embed announcements, assign/remove roles, timeout/kick members, configure log channels, and override modules per server.
- **Live Telemetry & Logs**: Real-time SSE log stream, bot presence editor, slash command sync button, and full audit trail.

### 3. Minecraft 24/7 Monitoring & History
- **24/7 Server Monitoring**: Supports both **Java Edition** and **Bedrock Edition** servers with configurable poll intervals.
- **Live Discord Alerts & Auto-Updating Status Board**: Alerts on server offline/recovery and player join/leave events, plus `/mc setup-board` to pin a live-updating status embed in Discord.
- **Server & Player History**:
  - Uptime %, average latency, peak players, interactive time-series charts (`1h` / `24h` / `7d` / `30d`), and outage incident logs.
  - Persistent player session tracking (`joined_at`, `left_at`, total playtime, session counts, per-server playtime breakdown) searchable in both the Web UI and `/mc players` / `/mc player`.
- **Optional RCON Console**: Permission-gated remote console execution from the Web UI or `/mc rcon`.

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment variables
cp .env.example .env

# 3. Run backend + web dev servers
npm run dev
# In a second terminal for Vite hot-reload:
npm run dev:web
```

For production build:
```bash
npm run build
npm start
```

---

## Proxmox Homelab Deployment

See [docs/PROXMOX_SETUP.md](docs/PROXMOX_SETUP.md) for the complete step-by-step guide (LXC/VM + Docker + Cloudflare Tunnel + Discord OAuth2 + one-command `./scripts/update.sh`).

For creating new modules, see [docs/MODULE_DEVELOPMENT.md](docs/MODULE_DEVELOPMENT.md).
