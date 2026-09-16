#!/bin/bash
# runNightly.sh — EN kedja för hela natten. Ersätter separata launchd-tider
# för purge (03:00), supervisor (04:30), discovery (05:00). Beslut 2026-09-16.
# Ordning: ingestion (13 steg) → purge → supervisor → discovery.
# Fortsätter alltid vidare även om ett steg faller; exit 1 om något steg föll
# (syns i launchctl list). Varje steg skriver sina egna loggar som förut.
#
# Schemaläggs av com.eventpulse.ingestion.plist kl 02:00 (det enda nattjobbet).

set -uo pipefail     # OBS: inte -e — kedjan ska aldrig avbrytas mitt i

PROJECT_ROOT="${PROJECT_ROOT:-/Users/claudgashi/EventPulse}"
cd "$PROJECT_ROOT"
TSX_BIN="$PROJECT_ROOT/node_modules/.bin/tsx"

# .env en gång för hela kedjan (barn-skripten sourcar själva också — ofarligt)
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Supervisor behöver dessa (samma som dess gamla plist hade):
export EVENTPULSE_PROJECT_ROOT="$PROJECT_ROOT"
export EVENTPULSE_VAULT_ROOT="${EVENTPULSE_VAULT_ROOT:-/Users/claudgashi/Desktop/MyVault/TomorGashi}"
# SKIP_BFL=1 ärvs från plisten → når ingestion-cron (D-images bibliotek-fallback).

declare -a RES=()

# run <namn> <cmd...> — kör, notera exit, fortsätt alltid vidare i kedjan.
run() {
  local name="$1"; shift
  echo "[nightly] ▶ ${name} start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "$@"
  local rc=$?
  RES+=("${name}=${rc}")
  echo "[nightly] ${name} exit=${rc}"
}

echo "[nightly] ═══ NIGHTLY CHAIN START $(date -u +%Y-%m-%dT%H:%M:%SZ) ═══"

run ingestion   bash scripts/cron/runIngestion.sh
run purge       bash scripts/start-purge.sh
run supervisor  "$TSX_BIN" 09-ScrapingSupervisor/runDaily.ts
run discovery   bash 09-DiscoveryAgent/cron/runDaily.sh

echo "[nightly] ═══ KLAR $(date -u +%Y-%m-%dT%H:%M:%SZ) ═══  ${RES[*]}"

# Exit 1 om något steg föll — syns som LastExitStatus i launchctl list.
for r in "${RES[@]}"; do
  [[ "$r" == *=0 ]] || exit 1
done
exit 0
