#!/bin/bash
# runNightly.sh — EN kedja för hela natten. PENSIONERAD 2026-10-07.
#
# Tidigare schemalagd av com.eventpulse.ingestion.plist kl 02:00. Nu är
# ingestion-chain direktanropad via tsx i plisten (för att undvika
# launchd-zombie-mönstret där bash höll stdout-rör öppet medan child
# hängde). Post-ingest-stegen körs av com.eventpulse.post-ingest.plist
# kl 04:00 via scripts/cron/runPostIngest.sh.
#
# Denna fil finns kvar för manuell debugging (kör `bash runNightly.sh`
# i en terminal om du vill köra allt i sekvens). Den anropas INTE av
# launchd längre.

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
  echo "[nightly-manual] ▶ ${name} start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "$@"
  local rc=$?
  RES+=("${name}=${rc}")
  echo "[nightly-manual] ${name} exit=${rc}"
}

echo "[nightly-manual] ═══ START (manuell körning — pensionerad kedja) ═══"

run ingestion      "$TSX_BIN" scripts/ingestion-cron.ts --limit 50
run link-health    "$TSX_BIN" 09-ScrapingSupervisor/check_link_health.ts --limit 200
run purge          bash scripts/start-purge.sh
run supervisor     "$TSX_BIN" 09-ScrapingSupervisor/runDaily.ts
run discovery      bash 09-DiscoveryAgent/cron/runDaily.sh
run mrq-prune      "$TSX_BIN" scripts/prune-mrq.ts --commit

echo "[nightly-manual] ═══ KLAR $(date -u +%Y-%m-%dT%H:%M:%SZ) ═══  ${RES[*]}"

for r in "${RES[@]}"; do
  [[ "$r" == *=0 ]] || exit 1
done
exit 0
