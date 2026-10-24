#!/usr/bin/env bash
# scripts/doctor.sh — read-only health check for verify-eventpulse-agent.
# Writes runtime/verification-reports/doctor-<TS>.json and prints it.
set -uo pipefail

AGENT_URL="${AGENT_URL:-https://eventpulse-agent.fly.dev}"
DASH_URL="${DASH_URL:-http://localhost:7777}"

mkdir -p runtime/verification-reports
TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
RPT="runtime/verification-reports/doctor-$TS.json"

# agent_health: ok or unreachable
AGENT_HEALTH=$(curl -fsS --max-time 10 "$AGENT_URL/agent/health" 2>/dev/null || echo '"unreachable"')

# dash_status_present: true / false / error
DASH_PRESENT=$(curl -fsS --max-time 10 "$DASH_URL/api/status" 2>/dev/null \
  | python3 -c "import json,sys
try:
  d=json.load(sys.stdin)
  print('true' if 'generatedAt' in d else 'false')
except Exception:
  print('error')" 2>/dev/null || echo 'error')

cat > "$RPT" <<EOF
{
  "ts": "$TS",
  "agent_url": "$AGENT_URL",
  "dash_url": "$DASH_URL",
  "agent_health": $AGENT_HEALTH,
  "dash_status_present": "$DASH_PRESENT"
}
EOF

cat "$RPT"