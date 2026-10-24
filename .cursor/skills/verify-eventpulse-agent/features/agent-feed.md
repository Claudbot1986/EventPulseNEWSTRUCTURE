# Agent feed (anonymous, future events)

## Sub-features
- Returns events filtered by `days` (default 7) and optional `category`
- Sorted by `start_time` ascending
- Past events are filtered out by default
- Optional user context (`req.user`) may enrich response but route is anonymous

## How to get to it (user POV)
The Expo app's "Hem" tab calls `GET /agent/feed`. The dashboard's "live feed preview" widget also uses it.

## Driving it with curl

```bash
AGENT_URL="${AGENT_URL:-https://eventpulse-agent.fly.dev}"

# Default 7-day window
curl -fsS --max-time 30 "$AGENT_URL/agent/feed" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', d) if isinstance(d, dict) else d
print(f'feed-7d: {len(events) if isinstance(events, list) else 0}')
"

# 30-day music
curl -fsS --max-time 30 "$AGENT_URL/agent/feed?category=music&days=30" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', d) if isinstance(d, dict) else d
print(f'feed-30d-music: {len(events) if isinstance(events, list) else 0}')
"

# First sample for human eyeballs
curl -fsS --max-time 30 "$AGENT_URL/agent/feed" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', d) if isinstance(d, dict) else d
if isinstance(events, list) and events:
    e = events[0]
    print(f\"{e.get('title') or e.get('title_sv') or '?'} @ {e.get('start_time') or e.get('date') or '?'}\")
else:
    print('(empty)')"
```

Expected:
- HTTP 200
- All events have `start_time >= now` (server filters past)
- Sorted ascending by `start_time`

## Gotchas
- **`days=0` returns past 30 days.** Some deployments interpret `0` as "no upper bound", others as "all history". Treat `0`-window results as drive-skipped unless verified against a specific deployment.
- **Empty category = same as no filter.** `category=` is silently ignored; drives should pin a known category like `music` for assertions.
- **This skill uses the helper `scripts/quick-feed.sh`** to produce `runtime/verification-reports/agent-feed-<TS>.json`. Run it as a standalone evidence capture (not part of the live-drive chain).