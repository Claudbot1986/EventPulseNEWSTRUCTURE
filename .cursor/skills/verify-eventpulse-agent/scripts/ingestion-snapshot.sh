#!/usr/bin/env bash
# scripts/ingestion-snapshot.sh — capture ingestion state at this moment.
set -uo pipefail

DASH_URL="${DASH_URL:-http://localhost:7777}"

mkdir -p runtime/verification-reports
TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
RPT="runtime/verification-reports/ingestion-snapshot-$TS.json"

STATUS=$(curl -fsS --max-time 10 "$DASH_URL/api/status" 2>/dev/null || echo '{"error":"unreachable"}')
INGESTION=$(curl -fsS --max-time 10 "$DASH_URL/api/ingestion/status" 2>/dev/null || echo '{"error":"unreachable"}')

# Use python to compose a valid JSON document from the two responses
python3 -c "
import json, sys
status = json.loads('''$STATUS''')
ingestion = json.loads('''$INGESTION''')
src = status.get('sources', {}) if isinstance(status, dict) else {}
cov = status.get('fieldCoverage', {}) if isinstance(status, dict) else {}
out = {
  'ts': '$TS',
  'dash_url': '$DASH_URL',
  'sources': {
    'total': src.get('total'),
    'working': src.get('working'),
    'dead': src.get('dead'),
    'untouched': src.get('untouched'),
  },
  'freshnessMedianHours': status.get('freshnessMedianHours') if isinstance(status, dict) else None,
  'fieldCoverage': {
    'title': cov.get('title'),
    'date': cov.get('date'),
    'venue': cov.get('venue'),
    'description': cov.get('description'),
  } if isinstance(cov, dict) else {},
  'ingestion': {
    'running': ingestion.get('running') if isinstance(ingestion, dict) else None,
    'pid': ingestion.get('pid') if isinstance(ingestion, dict) else None,
    'startedAt': ingestion.get('startedAt') if isinstance(ingestion, dict) else None,
    'lastError': ingestion.get('lastError') if isinstance(ingestion, dict) else None,
  },
}
with open('$RPT', 'w') as f:
  json.dump(out, f, indent=2, ensure_ascii=False)
print(json.dumps(out, indent=2, ensure_ascii=False))
"