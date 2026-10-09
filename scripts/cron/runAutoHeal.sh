#!/bin/bash
# runAutoHeal.sh — kör heal-loopen för misslyckade Stockholm-källor.
# Del av runPostIngest.sh (nattlig) + separat maj-launchd (årlig re-check av exhausted).
#
# Fas P / Fas P2 (2026-10-09):
# - Proaktiv heal-loop: testar alternativa URL:er (root, /evenemang, /kalender, etc.)
# - Max 10 källor/körning, max 3 URL-varianter/källa, max 3 heal-försök/källa
# - Exhausted-källor ignoreras tills deras nextRecheckAt passerat (default: 1 maj nästa år)
# - CLI: npx tsx 02-Ingestion/tools/autoHealFailedSources.ts [--may-recheck] [--source id1,id2]
#
# Cron-wrappen returnerar alltid 0 (fel loggas i runtime/heal-log.jsonl).

set -uo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/Users/claudgashi/EventPulse}"
cd "$PROJECT_ROOT"

if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

TSX_BIN="$PROJECT_ROOT/node_modules/.bin/tsx"

HEAL_MODE="${HEAL_MODE:-nightly}"  # nightly | may-recheck
HEAL_EXTRA_ARGS=""
if [ "$HEAL_MODE" = "may-recheck" ]; then
  HEAL_EXTRA_ARGS="--may-recheck"
  echo "[auto-heal] Läge: may-recheck (tvingar re-check av exhausted)"
else
  echo "[auto-heal] Läge: nightly (respekterar nextRecheckAt)"
fi

echo "[auto-heal] ▶ start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
"$TSX_BIN" 02-Ingestion/tools/autoHealFailedSources.ts $HEAL_EXTRA_ARGS 2>&1 | tee -a runtime/heal-cron.log
local_rc=${PIPESTATUS[0]}
echo "[auto-heal] exit=${local_rc}"

# Cron-wrappen returnerar alltid 0 (heal-loggen är källan till sanning)
exit 0