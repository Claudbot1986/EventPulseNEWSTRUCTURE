#!/bin/bash
# run-watchdog.sh — invoke the EventPulse autonomous-loop watchdog once.
#
# Runs `npx tsx 09-MobileControl/watchdog/watchdog.ts` from the project root.
# Logs go to runtime/autonomous-loop/watchdog.log (managed by watchdog.ts itself)
# and to runtime/watchdog-launchd.{out,err}.log (managed by launchd).
#
# Intended to be invoked by com.eventpulse.watchdog.plist every 2 hours.
# Can also be run manually:
#   ./scripts/run-watchdog.sh                # check + act
#   ./scripts/run-watchdog.sh --check        # report only, no action
#
# Threshold overrides (env):
#   WATCHDOG_STUCK_HOURS=4   (last_iter_at older → STUCK → SIGTERM)
#   WATCHDOG_DEAD_MIN=30     (process dead AND idle this long → DEAD → relaunch)
#   WATCHDOG_BUDGET_LOOP=3  (consecutive budget_exhausted → BUDGET_LOOP → alert)

set -eu

# Diagnostic: prove launchd is actually invoking us. This must be the very
# first line of execution — if it doesn't appear in launchd.out.log, launchd
# never reached the script (sandbox/TCC issue).
echo "[run-watchdog] PID=$$ $(date -u +%Y-%m-%dT%H:%M:%SZ) starting argv=$*"

PROJECT_ROOT="${PROJECT_ROOT:-/Volumes/2TB filer/NEWSTRUCTURE-COPY}"
cd "$PROJECT_ROOT"

mkdir -p "$PROJECT_ROOT/runtime/autonomous-loop"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/claudgashi/.local/bin:$PATH"

echo "[run-watchdog] $(date -u +%Y-%m-%dT%H:%M:%SZ) cwd=$(pwd) PATH=$PATH"
exec npx tsx 09-MobileControl/watchdog/watchdog.ts "$@"
