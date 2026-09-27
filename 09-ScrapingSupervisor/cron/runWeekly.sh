#!/bin/bash
# runWeekly.sh — Vecko-körning (söndagar kl 06:00, separat från runDaily):
#   [1/1] source_quality_report --full (URL-hälsotest, 200 HEAD:er)
#
# Tunga körningar som inte hör hemma i den dagliga pipelinen.
# Loggar allt till runtime/scraping-supervisor/weekly-YYYY-MM-DD.log.

set -e

PROJECT_ROOT="${PROJECT_ROOT:-/Users/claudgashi/EventPulse}"
LOG_DIR="$PROJECT_ROOT/runtime/scraping-supervisor"
DATE_STR=$(date +%Y-%m-%d)
WEEKLY_LOG="$LOG_DIR/weekly-$DATE_STR.log"
TSX_BIN="$PROJECT_ROOT/node_modules/.bin/tsx"

mkdir -p "$LOG_DIR"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1"
  echo "$msg" | tee -a "$WEEKLY_LOG"
}

log "═══════════════════════════════════════════════════════════"
log "  EventPulse vecko-körning  │  $DATE_STR"
log "═══════════════════════════════════════════════════════════"

# source_quality_report --full
# Utförlig version: 200 HEAD-anrop (top 10 källor × 20 URLs). Tar ~60-90 s wall-clock.
# Skriver source-quality-YYYY-MM-DD.md med URL-hälso-sektion.
log "[1/1] source_quality_report --full (URL-hälsa, 200 HEAD:er) — start"
if "$TSX_BIN" "$PROJECT_ROOT/04-Normalizer/_scripts/_source-quality-monitor.ts" --full >> "$WEEKLY_LOG" 2>&1; then
  log "[1/1] source_quality_report --full — OK"
else
  log "[1/1] source_quality_report --full — FAIL (exit=$?) — fortsätter ändå"
fi

log "═══════════════════════════════════════════════════════════"
log "  KLAR"
log "═══════════════════════════════════════════════════════════"