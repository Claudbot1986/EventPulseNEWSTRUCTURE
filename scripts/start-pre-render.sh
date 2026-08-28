#!/bin/bash
# start-pre-render.sh — run the EventPulse pre-render cron hourly.
#
# Loads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env, then runs
# 08-Agent/cron/pre_render_recommendations.ts in --loop mode.
#
# T0060 / MVP-gap §77: twice a day at 06:00 and 17:00 Stockholm time, walks
# all warm users (≥3 sessions in last 30d) and writes 3 pre-resolved
# prompt+card slots into cached_recommendations. Mirrors start-reminders.sh
# and start-follow-drops.sh.
#
# This is a long-lived daemon. Run it:
#   ./scripts/start-pre-render.sh
#
# Install as launchd agent for automatic startup across sleep/restart:
#   cp scripts/com.eventpulse.pre-render.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.eventpulse.pre-render.plist
#
# Uninstall:
#   launchctl unload ~/Library/LaunchAgents/com.eventpulse.pre-render.plist
#   rm ~/Library/LaunchAgents/com.eventpulse.pre-render.plist

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

echo "[start-pre-render] Starting pre-render cron (--loop, 06:00 + 17:00 Stockholm)…"
exec npx tsx 08-Agent/cron/pre_render_recommendations.ts --loop
