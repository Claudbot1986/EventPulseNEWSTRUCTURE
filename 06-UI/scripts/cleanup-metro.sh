#!/usr/bin/env bash
# cleanup-metro.sh — dödar Metro-starten som DENNA skillen startade.
#
#   ./scripts/cleanup-metro.sh
#
# Dödar bara PID:en i .runtime-metro.pid och en eventuell kvarvarande lyssnare
# på PORT (default 9090). Rör aldrig port 8081 eller andra Metro-instanser —
# de kan tillhöra en användares egen session.

set -uo pipefail

UI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-9090}"
PIDFILE="${UI_DIR}/.runtime-metro.pid"

PID=""
[ -f "$PIDFILE" ] && PID="$(cat "$PIDFILE" 2>/dev/null || true)"

if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || true
  echo "Killed Metro pid ${PID} (pidfile)"
else
  echo "No live Metro pid in ${PIDFILE}"
fi

# Riktad städning: endast den som fortfarande lyssnar på PORT.
for p in $(lsof -ti tcp:"${PORT}" 2>/dev/null); do
  kill "$p" 2>/dev/null || true
  echo "Killed remaining listener on port ${PORT} (pid ${p})"
done

rm -f "$PIDFILE"
echo "Cleanup done for port ${PORT}. Baseline screenshots and reports are left intact."
