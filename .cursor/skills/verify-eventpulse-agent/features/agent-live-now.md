# Live now feed

## Sub-features
- Returns events happening right now (start_time ≤ now ≤ end_time if end_time set, otherwise started within last 4 h)
- Optional `category` query param narrows by category
- Capped at ~30 results

## How to get to it (user POV)
The Expo app's "Live nu" screen calls `GET /agent/live-now`. It is the fastest lane in the agent — no ranking, no ranking reasons, just "what is happening right now in Stockholm".

## Driving it with curl

```bash
AGENT_URL="${AGENT_URL:-https://eventpulse-agent.fly.dev}"

# Default — all live
curl -fsS --max-time 30 "$AGENT_URL/agent/live-now" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', d) if isinstance(d, dict) else d
print(f'live-now: {len(events) if isinstance(events, list) else 0}')
if isinstance(events, list) and events:
    for e in events[:5]:
        title = e.get('title') or e.get('title_sv') or '?'
        start = e.get('start_time', '?')
        print(f'  - {start[:16]} | {title}')
"

# Music only
curl -fsS --max-time 30 "$AGENT_URL/agent/live-now?category=music" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', d) if isinstance(d, dict) else d
print(f'live-now music: {len(events) if isinstance(events, list) else 0}')
"
```

Expected:
- HTTP 200
- All returned events have `start_time <= now`

## Gotchas
- **Empty result during off-hours.** A 0-card result at 04:00 on a Sunday is *correct*, not a regression. Compare across dayparts, not absolute counts.
- **End-time fall-back.** When an event has no `end_time`, the route uses `start_time + 4h` as the upper bound. Drive-time assertions cannot pin a fixed window without a clock-injection point.
- **No auth.** Route is open; `optionalUser`-style. Origin must still match `AGENT_ALLOWED_ORIGINS` if you add a header.