#!/bin/bash
# start-sync-personalization.sh — run the EventPulse personalization-sync cron every 6h.
#
# Loads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env, then runs
# 08-Agent/cron/sync_personalization.ts in --loop mode.
#
# This is a long-lived daemon. Run it:
#   ./scripts/start-sync-personalization.sh
#
# Install as launchd agent for automatic startup across sleep/restart:
#   cp scripts/com.eventpulse.sync-personalization.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.eventpulse.sync-personalization.plist
#
# Uninstall:
#   launchctl unload ~/Library/LaunchAgents/com.eventpulse.sync-personalization.plist
#   rm ~/Library/LaunchAgents/com.eventpulse.sync-personalization.plist

set -eu

PROJECT_ROOT="${PROJECT_ROOT:-/Volumes/2TB filer/NEWSTRUCTURE-COPY}"

# Load secrets from .env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
fi

cd "$PROJECT_ROOT"

echo "[start-sync-personalization] Starting personalization cron (--loop, 6h interval)…"
exec npx tsx 08-Agent/cron/sync_personalization.ts --loop