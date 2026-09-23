#!/usr/bin/env bash
# process-manual-review-queue.sh — kör Rule E på manuell hanterings-kö.
#
# Syfte: automatisera Jev-beslut för nya entries som landar i
# runtime/postTestC-manual-review.jsonl. Per Jev investigation 2026-09-23:
#
#   - HTTP 404/403/5xx, Discovery failures → soft-quarantine (INDEX += 1)
#   - HTTP 429, Network <60d               → re_probe (tillbaka till active pool)
#   - Network 60+dagar                     → soft-quarantine (EJ retire — "en grav")
#   - Orphaned / STEP3-CHAIN               → remove-from-queue
#   - Low extraction / övrigt              → leave
#
# Säkerhet:
#   - Source-fil flyttas ALDRIG till /dev/null — bara till sources/_quarantine/
#   - INDEX.json är "graven" — källan finns kvar, vi rör den aldrig igen
#   - Removed entries hamnar i resolved.jsonl (audit trail)
#   - Idempotent: re-körning är safe, skippar redan INDEX-förda källor
#
# Användning:
#   ./scripts/process-manual-review-queue.sh                # kör --apply direkt
#   ./scripts/process-manual-review-queue.sh --dry-run      # visa vad som skulle hända
#   ./scripts/process-manual-review-queue.sh --jev          # Jev-validering före apply
#
# Cron-förslag (varje timme, drift via cron):
#   17 * * * * /Users/claudgashi/EventPulse/scripts/process-manual-review-queue.sh >> /Users/claudgashi/EventPulse/runtime/janitor-cron.log 2>&1
#
# Output hamnar i:
#   - runtime/data-janitor-audit.jsonl (audit trail)
#   - sources/_quarantine/INDEX.json     (grav-monumentet)
#   - 02-Ingestion/C-htmlGate/manual-review/resolved.jsonl (resolved-beslut)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

DRY_RUN=""
JEV_CHECK=""

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN="--dry-run" ;;
    --jev) JEV_CHECK="yes" ;;
    --help|-h)
      echo "Usage: process-manual-review-queue.sh [--dry-run] [--jev]"
      echo "  --dry-run   show what would happen, don't write anything"
      echo "  --jev       run Jev validation before applying"
      exit 0
      ;;
  esac
done

# Jev-validering (valfritt)
if [ -n "$JEV_CHECK" ] && [ -f "scripts/jev-call.py" ] && [ -n "${OPENROUTER_API_KEY:-}" ]; then
  echo "[auto-janitor] validating Rule E classification with Jev..."
  python3 scripts/jev-call.py \
    --type noul \
    --state "manual review queue cleanup, post-Fas D" \
    --question "Är pre-defined-klassificeringen (HTTP 404/403/5xx/discovery → soft-quarantine, 429/network<60d → re_probe, network 60+dagar → soft-quarantine, orphan/STEP3-CHAIN → remove-from-queue, C2/empty → leave) rimlig för kvarvarande 22 sourceIds i postTestC-manual-review.jsonl?" \
    --action "Om Jev säger >=0.7, kör --apply. Annars logga varning och skippa." || true
  echo ""
fi

# Kör Rule E
exec npx tsx 02-Ingestion/tools/dataJanitor.ts --rule E --cron ${DRY_RUN:---apply}
