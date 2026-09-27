#!/bin/bash
# runDaily.sh — Daglig körning:
#   [1/5] supervisor (source health review + auto-apply + vault reports)
#   [2/5] ingestionPipeline (data flow)
#   [3/5] check_link_health (HEAD-check av event-länkar, 1 HEAD per aktiv källa)
#   [4/5] quarantine_trigger (Hybrid B — reparationsprogram för källor cf>=2)
#   [5/5] source_quality_report (datakvalitet per källa, daily metrics)
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
log "[1/5] supervisor (source health) — start"
if "$TSX_BIN" "$PROJECT_ROOT/09-ScrapingSupervisor/supervisor.ts" >> "$DAILY_LOG" 2>&1; then
  log "[1/5] supervisor — OK"
else
  log "[1/5] supervisor — FAIL (exit=$?) — fortsätter ändå med pipeline"
fi

# Steg 2: ingestionPipeline (data flow)
log "[2/5] ingestionPipeline (data flow) — start"
if "$TSX_BIN" "$PROJECT_ROOT/09-ScrapingSupervisor/ingestionPipeline.ts" >> "$DAILY_LOG" 2>&1; then
  log "[2/5] ingestionPipeline — OK"
else
  log "[2/5] ingestionPipeline — FAIL (exit=$?)"
  exit 1
fi

# Steg 3: check_link_health (daglig HEAD-check av event-länkar)
# Uppdaterar events.link_status + link_last_checked_at + consecutive_broken_count
# + first_broken_at via RPC update_link_health_cf (migration 0004). ~200 HEAD-anrop,
# concurrency 10, ~30-60 s wall-clock. Non-fatal: en trasig källa här
# får inte stoppa övrig cron-pipeline.
log "[3/5] check_link_health (HEAD-check) — start"
if "$TSX_BIN" "$PROJECT_ROOT/09-ScrapingSupervisor/check_link_health.ts" >> "$DAILY_LOG" 2>&1; then
  log "[3/5] check_link_health — OK"
else
  log "[3/5] check_link_health — FAIL (exit=$?) — fortsätter ändå"
fi

# Steg 4: quarantine_trigger (Hybrid B reparationsprogram)
# Hittar källor vars cf just passerade 2 → skickar till manual-review-kön
# (02-Ingestion/C-htmlGate/manual-review/pending.jsonl). Idempotent via
# source-changes.jsonl. Non-fatal: ett enskilt DB-fel här får inte stoppa
# cron-pipelinen.
log "[4/5] quarantine_trigger (Hybrid B cf-trigger) — start"
if "$TSX_BIN" "$PROJECT_ROOT/09-ScrapingSupervisor/tools/quarantine_trigger.ts" --date "$DATE_STR" >> "$DAILY_LOG" 2>&1; then
  log "[4/5] quarantine_trigger — OK"
else
  log "[4/5] quarantine_trigger — FAIL (exit=$?) — fortsätter ändå"
fi

# Steg 5: source_quality_report (datakvalitet per källa)
# Daglig metrics: total events per källa, %Desc, %RichTitle, %Community, null_source.
# Skriver source-quality-YYYY-MM-DD.md till vault (ingen DB-mutation).
# Full URL-hälsotest (~200 HEAD) körs en gång per vecka via runWeekly.sh.
log "[5/5] source_quality_report (datakvalitet) — start"
if "$TSX_BIN" "$PROJECT_ROOT/04-Normalizer/_scripts/_source-quality-monitor.ts" >> "$DAILY_LOG" 2>&1; then
  log "[5/5] source_quality_report — OK"
else
  log "[5/5] source_quality_report — FAIL (exit=$?) — fortsätter ändå"
fi

log "═══════════════════════════════════════════════════════════"
log "  KLAR"
log "═══════════════════════════════════════════════════════════"
