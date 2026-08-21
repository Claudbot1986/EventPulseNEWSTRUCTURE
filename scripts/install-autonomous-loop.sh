#!/bin/bash
# install-autonomous-loop.sh — register the autonomous-loop wrapper as a
# macOS launchd job. Idempotent: safe to re-run.
#
# Defaults can be overridden via env:
#   PROJECT_ROOT         default = /Volumes/2TB filer/NEWSTRUCTURE-COPY
#   MAX_TOTAL_HOURS      default = 168 (7 days)
#   MAX_BUDGET_PER_ITER  default = 15
#   MAX_RESTARTS         default = 1000

set -eu

PROJECT_ROOT="${PROJECT_ROOT:-/Volumes/2TB filer/NEWSTRUCTURE-COPY}"
MAX_TOTAL_HOURS="${MAX_TOTAL_HOURS:-168}"
MAX_BUDGET_PER_ITER="${MAX_BUDGET_PER_ITER:-15}"
MAX_RESTARTS="${MAX_RESTARTS:-1000}"

PLIST_SRC="$PROJECT_ROOT/scripts/com.eventpulse.autonomous.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.eventpulse.autonomous.plist"

if [ ! -f "$PLIST_SRC" ]; then
  echo "ERROR: plist template not found at $PLIST_SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$PLIST_DST")"

# Substitute placeholders.
sed -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__MAX_TOTAL_HOURS__|$MAX_TOTAL_HOURS|g" \
    -e "s|__MAX_BUDGET_PER_ITER__|$MAX_BUDGET_PER_ITER|g" \
    -e "s|__MAX_RESTARTS__|$MAX_RESTARTS|g" \
    "$PLIST_SRC" > "$PLIST_DST"

echo "wrote $PLIST_DST"

# If already loaded, unload first to pick up the new file.
if launchctl list 2>/dev/null | grep -q "com.eventpulse.autonomous"; then
  echo "unloading existing job..."
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  sleep 1
fi

echo "loading job..."
launchctl load "$PLIST_DST"

echo
echo "=== installed ==="
echo "label:     com.eventpulse.autonomous"
echo "plist:     $PLIST_DST"
echo "logs:      $PROJECT_ROOT/runtime/autonomous-loop/"
echo "supervise: launchctl list | grep com.eventpulse.autonomous"
echo "stop:      scripts/autonomous-loop.sh --stop"
echo "uninstall: launchctl unload $PLIST_DST && rm $PLIST_DST"
