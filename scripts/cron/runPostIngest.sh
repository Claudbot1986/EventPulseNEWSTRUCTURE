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

run link-health    "$TSX_BIN" 09-ScrapingSupervisor/check_link_health.ts --limit 200
run purge          bash scripts/start-purge.sh
run supervisor     "$TSX_BIN" 09-ScrapingSupervisor/runDaily.ts
run discovery      bash 09-DiscoveryAgent/cron/runDaily.sh
run mrq-prune      "$TSX_BIN" scripts/prune-mrq.ts --commit
run quota-check    "$TSX_BIN" scripts/_check_image_quota.ts --emit-plan

echo "[post-ingest] ═══ KLAR $(date -u +%Y-%m-%dT%H:%M:%SZ) ═══  ${RES[*]}"

for r in "${RES[@]}"; do
  [[ "$r" == *=0 ]] || exit 1
done
exit 0