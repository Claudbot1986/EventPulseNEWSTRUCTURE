#!/usr/bin/env bash
# scripts/quick-feed.sh — prove /agent/feed returns a non-empty list of valid events.
set -uo pipefail

AGENT_URL="${AGENT_URL:-https://eventpulse-agent.fly.dev}"

mkdir -p runtime/verification-reports
TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
RPT="runtime/verification-reports/agent-feed-$TS.json"

# Default 7-day window
DEFAULT_BODY=$(curl -fsS --max-time 30 "$AGENT_URL/agent/feed" 2>/dev/null || echo '{"error":"unreachable"}')
DEFAULT_COUNT=$(echo "$DEFAULT_BODY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', d) if isinstance(d, dict) else d
print(len(events) if isinstance(events, list) else 0)")

# Music 30-day window
MUSIC_BODY=$(curl -fsS --max-time 30 "$AGENT_URL/agent/feed?category=music&days=30" 2>/dev/null || echo '{"error":"unreachable"}')
MUSIC_COUNT=$(echo "$MUSIC_BODY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', d) if isinstance(d, dict) else d
print(len(events) if isinstance(events, list) else 0)")

# First sample for human eyeballs
FIRST=$(echo "$DEFAULT_BODY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', d) if isinstance(d, dict) else d
if isinstance(events, list) and events:
  e = events[0]
  print(f\"{e.get('title') or e.get('title_sv') or '?'} @ {e.get('start_time') or e.get('date') or '?'}\")
else:
  print('(empty)')" 2>/dev/null)

cat > "$RPT" <<EOF
{
  "ts": "$TS",
  "agent_url": "$AGENT_URL",
  "default_7d_count": $DEFAULT_COUNT,
  "music_30d_count": $MUSIC_COUNT,
  "first_default_event": "$FIRST"
}
EOF

cat "$RPT"