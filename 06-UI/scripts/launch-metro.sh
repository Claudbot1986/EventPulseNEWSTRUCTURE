#!/usr/bin/env bash
# launch-metro.sh — start Metro (Expo web build) för verify-eventpulse-ui.
#
# Ägs av verification-skillen .cursor/skills/verify-eventpulse-ui/.
# Startar Metro på PORT (default 9090), skriver PID till .runtime-metro.pid
# och loggar till /tmp/eventpulse-metro-<port>.log.
#
#   PORT=9090 ./scripts/launch-metro.sh
#
# Env-variablerna (EXPO_PUBLIC_*) laddas från 06-UI/.env → projektets .env.
# De läses vid bundle-time: ändra .env och starta om Metro.

set -euo pipefail

UI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-9090}"
LOG="${METRO_LOG:-/tmp/eventpulse-metro-${PORT}.log}"
PIDFILE="${UI_DIR}/.runtime-metro.pid"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Metro already running (pid $(cat "$PIDFILE")) on port ${PORT}"
  exit 0
fi

if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ERROR: port ${PORT} is already in use by another process." >&2
  echo "       Use a different port: PORT=9091 ./scripts/launch-metro.sh" >&2
  exit 1
fi

cd "$UI_DIR"

# Ett externt satt EXPO_PUBLIC_AGENT_URL vinner över .env (t.ex. den lokala
# dev-agenten på :8787). .env laddas efteråt, så variabeln måste sparas först.
AGENT_URL_OVERRIDE="${EXPO_PUBLIC_AGENT_URL:-}"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ -n "${AGENT_URL_OVERRIDE}" ]; then
  export EXPO_PUBLIC_AGENT_URL="${AGENT_URL_OVERRIDE}"
  echo "Agent URL override: ${EXPO_PUBLIC_AGENT_URL}"
fi

nohup npx expo start --host lan --port "${PORT}" >"${LOG}" 2>&1 &
echo $! >"${PIDFILE}"

echo "Metro starting on port ${PORT} (pid $(cat "$PIDFILE"))"
echo "Log: ${LOG}"
echo "Ready when the log shows 'Waiting on http://localhost:${PORT}' AND the first GET / returns 200."
