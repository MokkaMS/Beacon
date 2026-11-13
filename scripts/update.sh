#!/usr/bin/env bash
set -euo pipefail

# One-command Proxmox Homelab update script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "==> Backing up SQLite database before update..."
"$SCRIPT_DIR/backup.sh" || true

if [ -d ".git" ]; then
  echo "==> Pulling latest changes from git..."
  git pull --ff-only
fi

echo "==> Rebuilding and restarting containers..."
docker compose up -d --build --remove-orphans

echo "==> Cleaning up dangling Docker images..."
docker image prune -f

echo "==> Update complete! Current status:"
docker compose ps
