#!/bin/bash
# runPostIngest.sh — kör EFTER ingestion-cron (som launchd kör direkt).
# Innehåller link-health, purge, supervisor, discovery, mrq-prune, image-quota-check.
# Schemaläggs av com.eventpulse.post-ingest.plist kl 04:00.
#
# 2026-10-07 — separerad från runNightly.sh så att ingestion-chain kan köras
# av launchd via tsx-direktanrop (inte via bash-wrapper). Annars kan en hängande
# child-process maskera att bash är vid liv → launchd tror allt är OK → startar
# aldrig om nästa planerade körning.
#
# 2026-10-08 — quota-check efter mrq-prune (användarbeslut). Skriver ENDAST plan-JSON,
# genererar inga BFL-bilder. Användaren granskar plan och kör round5 manuellt.

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

export EVENTPULSE_PROJECT_ROOT="$PROJECT_ROOT"
export EVENTPULSE_VAULT_ROOT="${EVENTPULSE_VAULT_ROOT:-/Users/claudgashi/Desktop/MyVault/TomorGashi}"
# 2026-10-28 — importen har EN ägare: cron 02:00 (scripts/ingestion-cron.ts).
# Den här vägen (04:00) körde samma import igen, vilket gjorde att samma
# events köades upp två gånger per natt. Flaggan gör vägen idempotent.
export EVENTPULSE_IMPORT_MODE=never

declare -a RES=()

run() {
  local name="$1"; shift
  echo "[post-ingest] ▶ ${name} start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "$@"
  local rc=$?
  RES+=("${name}=${rc}")
  echo "[post-ingest] ${name} exit=${rc}"
}

echo "[post-ingest] ═══ START $(date -u +%Y-%m-%dT%H:%M:%SZ) ═══"

# 2026-10-28 — preflight. Post-ingest får INTE köra i en trasig värld.
# Samma skäl som nattkedjan: 26/27/28 okt dog nätverksstacken och kedjan
# skrev "klart" med 0 events. Preflight mäter världen först och avbryter
# med exit 69 i stället för att köra 13 steg mot död infrastruktur.
# Mjuka kontroller (7777/7778) blockerar inte — bara hårda.
echo "[post-ingest] ▶ preflight start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if ! node "$PROJECT_ROOT/scripts/lib/preflight.mjs"; then
  echo "[post-ingest] preflight MISSLYCKADES — post-ingest körs inte (exit 69)"
  exit 69
fi
echo "[post-ingest] preflight exit=0"

run link-health    "$TSX_BIN" 09-ScrapingSupervisor/check_link_health.ts --limit 200
run purge          bash scripts/start-purge.sh
run supervisor     "$TSX_BIN" 09-ScrapingSupervisor/runDaily.ts
run discovery      bash 09-DiscoveryAgent/cron/runDaily.sh
run mrq-prune      "$TSX_BIN" scripts/prune-mrq.ts --commit
# 2026-10-09 — Val C fas A: auto-nattlig D-render-pilot för 5 source-specifika
# Stockholm-källor. Resultatet loggas i runtime/d-render-pilot/log.jsonl.
# Cron-wrappen returnerar alltid 0 (fel loggas i JSONL).
run d-render-pilot bash scripts/cron/runD-render-pilot.sh
# 2026-10-09 — Fas P: auto-nattlig heal-loop för cf≤3 Stockholm-källor med 0 events.
# Loggar till runtime/heal-log.jsonl. Exhausted-källor (efter 3 misslyckade försök) respekteras
# tills nextRecheckAt (default 1 maj nästa år). Cron-wrappen returnerar alltid 0.
run auto-heal      bash scripts/cron/runAutoHeal.sh
run quota-check    "$TSX_BIN" scripts/_check_image_quota.ts --emit-plan
# 2026-10-09 — Stream A.2 eval-hook: kör ground truth mot senaste batch
run eval-gate      "$TSX_BIN" runtime/ingestion/eval/run-eval.ts --gate A-to-B
run eval-schema    "$TSX_BIN" runtime/ingestion/eval/_schemas/smoke-test.ts

echo "[post-ingest] ═══ KLAR $(date -u +%Y-%m-%dT%H:%M:%SZ) ═══  ${RES[*]}"

for r in "${RES[@]}"; do
  [[ "$r" == *=0 ]] || exit 1
done
exit 0