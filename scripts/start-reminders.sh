#!/bin/bash
# start-reminders.sh — run the EventPulse reminder cron every ~15 minutes.
#
# Loads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env, then runs
# 08-Agent/cron/reminders.ts in --loop mode.
#
# This is a long-lived daemon. Run it:
#   ./scripts/start-reminders.sh
#
# Install as launchd agent for automatic startup across sleep/restart:
#   cp scripts/com.eventpulse.reminders.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.eventpulse.reminders.plist
#
# Uninstall:
#   launchctl unload ~/Library/LaunchAgents/com.eventpulse.reminders.plist
#   rm ~/Library/LaunchAgents/com.eventpulse.reminders.plist

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

echo "[start-reminders] Starting reminder cron (--loop, 15 min interval)…"
exec npx tsx 08-Agent/cron/reminders.ts --loop
