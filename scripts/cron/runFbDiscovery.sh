#!/bin/bash
#
# scripts/cron/runFbDiscovery.sh — Daily FB Events discovery ingestion.
#
# Re-polls all known-working FB-pages via Apify, persists new events.
# Cheap (~ $0.005-0.05 per page per run, ~$0.50/day for 22 working pages).
#
# Användning:
#   bash scripts/cron/runFbDiscovery.sh
#
# Schemaläggs via com.eventpulse.fb-discovery.plist (kl 03:30 varje natt).

set -euo pipefail

PROJECT_ROOT="/Users/claudgashi/EventPulse"
cd "$PROJECT_ROOT"

# Ladda .env
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

DATE_STR=$(date +%Y-%m-%d)
LOG_DIR="$PROJECT_ROOT/runtime/fb-discovery"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/daily-$DATE_STR.log"

echo "=== FB Discovery cron — $(date -Iseconds) ===" | tee -a "$LOG_FILE"

# Step 1: Test all known-working pages
echo "" | tee -a "$LOG_FILE"
echo "Step 1: Test working pages..." | tee -a "$LOG_FILE"
if ! node scripts/fb-discovery-engine.mjs --test-working 2>&1 | tee -a "$LOG_FILE"; then
  echo "ERROR: --test-working failed" | tee -a "$LOG_FILE"
  exit 1
fi

# Step 2: AI research — try to discover new candidate pages
# (Skipped by default if no MiniMax key — uncomment to enable)
# if [ -n "$MINIMAX_API_KEY" ]; then
#   echo "" | tee -a "$LOG_FILE"
#   echo "Step 2: AI research for new candidate pages..." | tee -a "$LOG_FILE"
#   if ! node scripts/research-fb-pages.mjs --auto-discover 2>&1 | tee -a "$LOG_FILE"; then
#     echo "WARN: AI research failed (continuing)" | tee -a "$LOG_FILE"
#   fi
# fi

# Step 3: Check Apify usage
echo "" | tee -a "$LOG_FILE"
echo "Step 3: Apify usage check..." | tee -a "$LOG_FILE"
COST=$(curl -sS "https://api.apify.com/v2/users/me/usage/monthly" \
  -H "Authorization: Bearer $APIFY_API_KEY" 2>&1 | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    total = sum(info.get('amountAfterVolumeDiscountUsd', 0) for info in d.get('data', {}).get('monthlyServiceUsage', {}).values())
    print(f'\${total:.4f}')
except: print('unknown')
")
echo "Apify monthly cost: $COST" | tee -a "$LOG_FILE"

echo "" | tee -a "$LOG_FILE"
echo "=== Done — $(date -Iseconds) ===" | tee -a "$LOG_FILE"