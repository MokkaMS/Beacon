#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$ROOT_DIR/data"
BACKUP_DIR="$DATA_DIR/backups"
DB_FILE="$DATA_DIR/bot.db"

if [ ! -f "$DB_FILE" ]; then
  echo "No database found at $DB_FILE (skipping backup)."
  exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/bot-$STAMP.db"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$OUT_FILE'"
else
  cp "$DB_FILE" "$OUT_FILE"
fi

# Keep last 14 backups
ls -1t "$BACKUP_DIR"/bot-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f

echo "Backup saved to $OUT_FILE"
