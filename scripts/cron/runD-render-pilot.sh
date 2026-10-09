#!/bin/bash
# scripts/cron/runD-render-pilot.sh — Natten kör D-render-piloten för
# 5 source-specifika Stockholm-källor (se 02-Ingestion/D-renderGate/
# sourceAllowlist.ts). Körs inom post-ingest-kedjan kl 04:00.
#
# Inte ett separat launchd-jobb: läggs till som ett steg i
# runPostIngest.sh. Slipper launchd-installation.
#
# 2026-10-09 — Val C fas A: auto-nattlig D-render-pilot.

set -uo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/Users/claudgashi/EventPulse}"
cd "$PROJECT_ROOT"
TSX_BIN="$PROJECT_ROOT/node_modules/.bin/tsx"

if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

echo "[d-render-pilot] ▶ START $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 5 pilotkällor körs serialt (se run-all.ts). Total tid ~30s.
# Exit-kod ignoreras så att post-ingest-kedjan kan fortsätta även
# om piloten failar; resultatet finns i runtime/d-render-pilot/log.jsonl.
"$TSX_BIN" 02-Ingestion/D-renderGate/cron/run-all.ts
rc=$?

echo "[d-render-pilot] ▶ SLUT exit=${rc} $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Returnera 0 så post-ingest-kedjan inte bryts. Reella fel loggas i
# log.jsonl och kan detekteras via dashboard-queries på den filen.
exit 0
