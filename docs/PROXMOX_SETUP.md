# Beacon — Proxmox Homelab Setup Guide (Docker + Cloudflare Tunnel)

This guide walks you through deploying and updating the bot on your Proxmox homelab with **zero open router ports** and worldwide HTTPS access to the Admin Web-Page.

---

## 1. Create a Proxmox VM or LXC Container
- **Recommended**: Ubuntu 24.04 LTS VM (or LXC with `nesting=1` enabled in Proxmox Options -> Features).
- Install Docker & Docker Compose:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  ```

## 2. Create Your Discord Application
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Under **Bot**:
   - Click **Reset Token** and save it as `DISCORD_TOKEN`.
   - Enable **Server Members Intent** and **Presence Intent** (needed for member management and role lookups).
3. Under **OAuth2 -> General**:
   - Copy **Client ID** (`DISCORD_CLIENT_ID`) and **Client Secret** (`DISCORD_CLIENT_SECRET`).
   - Add a **Redirect** URL matching your public domain, e.g.:
     `https://bot.yourdomain.com/api/auth/callback`
4. Find your own Discord User ID (enable Developer Mode in Discord -> right-click your profile -> Copy User ID) and set `BOT_OWNER_IDS`.

## 3. Configure Cloudflare Tunnel (Worldwide HTTPS Access)
1. Open [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) -> **Networks -> Tunnels -> Create a tunnel**.
2. Choose **Cloudflared**, name it (e.g. `homelab-bot`), and copy the **Tunnel Token** (`eyJ...`) into `CLOUDFLARE_TUNNEL_TOKEN` in `.env`.
3. Under **Public Hostname**, add:
   - **Subdomain / Domain**: `bot.yourdomain.com`
   - **Service Type**: `HTTP`
   - **URL**: `bot:3000` (the Docker Compose service name!)

## 4. Deploy on Proxmox
```bash
git clone https://github.com/MokkaMS/Beacon homelab-bot
cd homelab-bot
cp .env.example .env
nano .env   # Fill in DISCORD_*, BOT_OWNER_IDS, PUBLIC_URL, DISCORD_REDIRECT_URI, SESSION_SECRET, CLOUDFLARE_TUNNEL_TOKEN

# Generate a strong SESSION_SECRET:
openssl rand -hex 32

# Start the bot + Cloudflare Tunnel
docker compose up -d --build
```

Check logs:
```bash
docker compose logs -f bot
```

Visit `https://bot.yourdomain.com` from anywhere in the world and click **Continue with Discord**!

---

## 5. Updating & Backups
To pull new code/modules, back up the SQLite database, rebuild, and restart cleanly:
```bash
chmod +x scripts/update.sh scripts/backup.sh
./scripts/update.sh
```

Backups are stored automatically in `./data/backups/` (last 14 snapshots retained).
