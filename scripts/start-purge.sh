#!/bin/bash
# start-purge.sh — daglig rensning av events äldre än gårdagen.
#
# Laddar SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY från .env, kör
# purge_yesterday_events.ts --apply. Avslutas direkt (inte --loop).
# launchd-plist sätter StartCalendarInterval (Hour=3, Minute=0).
#
# Säkerhetsnot: sparade events (user_interaction_save) flyttas till
# runtime/archive/saved-events.jsonl som backup — de raderas INTE.
#
# Manuell körning (för test):
#   bash scripts/start-purge.sh
#
# Install som launchd-agent:
#   cp scripts/com.eventpulse.purge.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.eventpulse.purge.plist
#
# Uninstall:
#   launchctl unload ~/Library/LaunchAgents/com.eventpulse.purge.plist
#   rm ~/Library/LaunchAgents/com.eventpulse.purge.plist

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

echo "[start-purge] $(date -Iseconds) start"
npx tsx scripts/purge_yesterday_events.ts --apply >> runtime/purge.log 2>&1
EXIT=$?
echo "[start-purge] $(date -Iseconds) exit=$EXIT"
exit $EXIT
