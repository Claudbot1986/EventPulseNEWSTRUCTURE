#!/bin/bash
#
# scripts/cron/runSmoke.sh — Smoke-test av hela ingestion-cron-pipelinen.
#
# Kör ALLA 14 steg med minimal data (--limit=1 för A/B/D/I-pdf/etag,
# --limit=3 för imageGen-bibliotek, --dry-run=true för P3C RSS) så vi kan
# verifiera att kedjan är hel UTAN att bränna Scrapingbee-credits eller
# BFL-budget.
#
# Skillnad mot runIngestion.sh:
#   - runIngestion.sh: skarpt läge (--limit=50, alla BFL-fallback aktiv)
#   - runSmoke.sh: verifierings-läge (--smoke, alla BFL-fallback avstängt)
#
# Manuell körning:
#   bash scripts/cron/runSmoke.sh
#
# Skapad 2026-09-10 (Del B i P3C+-planen).

set -euo pipefail

PROJECT_ROOT="/Users/claudgashi/EventPulse"
cd "$PROJECT_ROOT"

# Ladda .env till shell-miljön (launchd ärver inte env automatiskt)
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
fi

LOG_DIR="$PROJECT_ROOT/runtime/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
LOG_FILE="$LOG_DIR/smoke-${TIMESTAMP}.log"
SUMMARY_FILE="$LOG_DIR/smoke-${TIMESTAMP}.summary.json"

echo "[runSmoke] starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee "$LOG_FILE"
echo "[runSmoke] log: $LOG_FILE"

# Kör smoke-läget. --limit=1 är redundant (--smoke sätter redan effectiveLimit=1)
# men gör syftet explicit för log-läsare.
npx tsx scripts/ingestion-cron.ts --smoke --limit=1 2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}
echo "[runSmoke] finished with exit code $EXIT_CODE at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG_FILE"

# Skriv en kort sammanfattning som är lätt att skanna
cat > "$SUMMARY_FILE" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "log_file": "$LOG_FILE",
  "exit_code": $EXIT_CODE,
  "mode": "smoke",
  "limit": 1
}
EOF

if [ $EXIT_CODE -ne 0 ]; then
  echo "[runSmoke] FAIL — exit code $EXIT_CODE. Inspektera $LOG_FILE"
  exit $EXIT_CODE
fi

echo "[runSmoke] OK"