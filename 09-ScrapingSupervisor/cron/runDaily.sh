#!/bin/bash
# runDaily.sh — Daglig körning:
#   [1] supervisor (source health review + auto-apply + vault reports)
#   [2] ingestionPipeline (data flow)
#   [3] check_link_health (HEAD-check av event-länkar, 1 HEAD per aktiv källa)
#
# Används av com.eventpulse.supervisor.plist kl 04:30.
# Loggar allt till runtime/scraping-supervisor/daily-YYYY-MM-DD.log.

set -e

# Canonical repo (2026-09-15: inget dagligt jobb får köras mot extern volym).
PROJECT_ROOT="${PROJECT_ROOT:-/Users/claudgashi/EventPulse}"
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
log "[1/3] supervisor (source health) — start"
if "$TSX_BIN" "$PROJECT_ROOT/09-ScrapingSupervisor/supervisor.ts" >> "$DAILY_LOG" 2>&1; then
  log "[1/3] supervisor — OK"
else
  log "[1/3] supervisor — FAIL (exit=$?) — fortsätter ändå med pipeline"
fi

# Steg 2: ingestionPipeline (data flow)
log "[2/3] ingestionPipeline (data flow) — start"
if "$TSX_BIN" "$PROJECT_ROOT/09-ScrapingSupervisor/ingestionPipeline.ts" >> "$DAILY_LOG" 2>&1; then
  log "[2/3] ingestionPipeline — OK"
else
  log "[2/3] ingestionPipeline — FAIL (exit=$?)"
  exit 1
fi

# Steg 3: check_link_health (daglig HEAD-check av event-länkar)
# Uppdaterar events.link_status + link_last_checked_at. ~200 HEAD-anrop,
# concurrency 10, ~30-60 s wall-clock. Non-fatal: en trasig källa här
# får inte stoppa övrig cron-pipeline.
log "[3/3] check_link_health (HEAD-check) — start"
if "$TSX_BIN" "$PROJECT_ROOT/09-ScrapingSupervisor/check_link_health.ts" >> "$DAILY_LOG" 2>&1; then
  log "[3/3] check_link_health — OK"
else
  log "[3/3] check_link_health — FAIL (exit=$?) — fortsätter ändå"
fi

log "═══════════════════════════════════════════════════════════"
log "  KLAR"
log "═══════════════════════════════════════════════════════════"
