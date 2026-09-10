#!/bin/bash
# start-ingestion.sh — natlig ingestion A→B→C→bilder.
#
# Laddar .env, kör scripts/ingestion-cron.ts som orchestrator.
# launchd-plist sätter StartCalendarInterval (Hour=2, Minute=30).
#
# Manuell körning (för test):
#   bash scripts/start-ingestion.sh
#
# Install som launchd-agent:
#   cp scripts/com.eventpulse.ingestion.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.eventpulse.ingestion.plist
#
# Uninstall:
#   launchctl unload ~/Library/LaunchAgents/com.eventpulse.ingestion.plist
#   rm ~/Library/LaunchAgents/com.eventpulse.ingestion.plist

set -eu

PROJECT_ROOT="${PROJECT_ROOT:-/Users/claudgashi/EventPulse}"

# Ladda hemligheter från .env
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
fi

cd "$PROJECT_ROOT"
mkdir -p runtime

echo "[start-ingestion] $(date -Iseconds) start"
npx tsx scripts/ingestion-cron.ts >> runtime/ingestion-cron.log 2>&1
EXIT=$?
echo "[start-ingestion] $(date -Iseconds) exit=$EXIT"
exit $EXIT
