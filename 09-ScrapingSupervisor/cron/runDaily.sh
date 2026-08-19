#!/bin/bash
# runDaily.sh — Daglig körning: supervisor (source health) + ingestionPipeline (data flow)
#
# Används av com.eventpulse.supervisor.plist kl 04:30.
# Loggar allt till runtime/scraping-supervisor/daily-YYYY-MM-DD.log.

set -e

PROJECT_ROOT="/Volumes/2TB filer/NEWSTRUCTURE-COPY"
LOG_DIR="$PROJECT_ROOT/runtime/scraping-supervisor"
DATE_STR=$(date +%Y-%m-%d)
DAILY_LOG="$LOG_DIR/daily-$DATE_STR.log"
TSX_BIN="$PROJECT_ROOT/node_modules/.bin/tsx"

mkdir -p "$LOG_DIR"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1"
  echo "$msg" | tee -a "$DAILY_LOG"
}

log "═══════════════════════════════════════════════════════════"
log "  EventPulse daglig körning  │  $DATE_STR"
log "═══════════════════════════════════════════════════════════"

# Steg 1: supervisor (source health review + auto-apply + vault reports)
log "[1/2] supervisor (source health) — start"
if "$TSX_BIN" "$PROJECT_ROOT/09-ScrapingSupervisor/supervisor.ts" >> "$DAILY_LOG" 2>&1; then
  log "[1/2] supervisor — OK"
else
  log "[1/2] supervisor — FAIL (exit=$?) — fortsätter ändå med pipeline"
fi

# Steg 2: ingestionPipeline (data flow)
log "[2/2] ingestionPipeline (data flow) — start"
if "$TSX_BIN" "$PROJECT_ROOT/09-ScrapingSupervisor/ingestionPipeline.ts" >> "$DAILY_LOG" 2>&1; then
  log "[2/2] ingestionPipeline — OK"
else
  log "[2/2] ingestionPipeline — FAIL (exit=$?)"
  exit 1
fi

log "═══════════════════════════════════════════════════════════"
log "  KLAR"
log "═══════════════════════════════════════════════════════════"
