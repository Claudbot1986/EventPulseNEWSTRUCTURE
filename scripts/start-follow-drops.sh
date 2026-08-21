#!/bin/bash
# start-follow-drops.sh — run the EventPulse follow-drop cron every ~30 minutes.
#
# Loads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env, then runs
# 08-Agent/cron/follow_drops.ts in --loop mode.
#
# T0059 / MVP-gap §77: every 30 min, walks all users who follow at least
# one venue and materializes follow_drop notifications for events whose
# `freshness_at` falls in the recent window. Mirrors start-reminders.sh
# but on a 30-min cadence (venue drops are slower-moving than 2h
# reminders, so a sparser pass is fine).
#
# This is a long-lived daemon. Run it:
#   ./scripts/start-follow-drops.sh
#
# Install as launchd agent for automatic startup across sleep/restart:
#   cp scripts/com.eventpulse.followdrops.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.eventpulse.followdrops.plist
#
# Uninstall:
#   launchctl unload ~/Library/LaunchAgents/com.eventpulse.followdrops.plist
#   rm ~/Library/LaunchAgents/com.eventpulse.followdrops.plist

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

echo "[start-follow-drops] Starting follow-drop cron (--loop, 30 min interval)…"
exec npx tsx 08-Agent/cron/follow_drops.ts --loop
