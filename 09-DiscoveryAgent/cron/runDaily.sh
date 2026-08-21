#!/bin/bash
# runDaily.sh — Daglig körning av T0095 autonomous discovery agent.
#
# Används av com.eventpulse.discovery.plist kl 04:30.
# Loggar allt till runtime/discovery-agent/daily-YYYY-MM-DD.log.
#
# Caps (hårdkodade här också, dubbleras i agent.ts):
#   MAX=5   — max sources touched per phase
#   DRY_RUN=0 — faktiska körningar (sätt till 1 för test)

set -e

PROJECT_ROOT="/Volumes/2TB filer/NEWSTRUCTURE-COPY"
LOG_DIR="$PROJECT_ROOT/runtime/discovery-agent"
DATE_STR=$(date +%Y-%m-%d)
DAILY_LOG="$LOG_DIR/daily-$DATE_STR.log"
TSX_BIN="$PROJECT_ROOT/node_modules/.bin/tsx"

MAX="${MAX:-5}"
DRY_RUN="${DRY_RUN:-0}"

mkdir -p "$LOG_DIR"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1"
  echo "$msg" | tee -a "$DAILY_LOG"
}

log "═══════════════════════════════════════════════════════════"
log "  EventPulse discovery-agent  │  $DATE_STR  │  MAX=$MAX DRY_RUN=$DRY_RUN"
log "═══════════════════════════════════════════════════════════"

# Steg 1: discovery-agent (heal + promote + expand)
log "[1/1] discovery-agent — start"
if MAX="$MAX" DRY_RUN="$DRY_RUN" "$TSX_BIN" "$PROJECT_ROOT/09-DiscoveryAgent/agent.ts" >> "$DAILY_LOG" 2>&1; then
  log "[1/1] discovery-agent — OK"
else
  EXIT=$?
  log "[1/1] discovery-agent — FAIL (exit=$EXIT) — se logg ovan"
  # Avsluta med 0 så att launchd inte flappar och triggar ThrottleInterval.
  # Felet är redan loggat i runs.jsonl + daily.log.
fi

log "═══════════════════════════════════════════════════════════"
log "  KLAR"
log "═══════════════════════════════════════════════════════════"

exit 0
