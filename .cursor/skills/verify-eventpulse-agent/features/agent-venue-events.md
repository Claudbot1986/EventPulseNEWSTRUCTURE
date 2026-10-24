# Per-venue events

## Sub-features
- Returns events filtered by `venueId`
- Sorted by `start_time` ascending
- Past events are filtered out by default (only future)

## How to get to it (user POV)
The Karta (map) screen taps a venue pin and shows that venue's upcoming events. It calls `GET /agent/venues/:venueId/events`.

## Driving it with curl

```bash
AGENT_URL="${AGENT_URL:-https://eventpulse-agent.fly.dev}"

# Pick a venueId known to be active. Get one from a feed call first.
FEED=$(curl -fsS --max-time 30 "$AGENT_URL/agent/feed?days=30")
VENUE_ID=$(echo "$FEED" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', d) if isinstance(d, dict) else d
for e in events:
    if e.get('venue_id'):
        print(e['venue_id'])
        break
")
if [ -z "$VENUE_ID" ]; then
  echo 'no venue_id in feed — cannot drive'
  exit 0
fi
echo "driving with venue_id=$VENUE_ID"
curl -fsS --max-time 30 "$AGENT_URL/agent/venues/$VENUE_ID/events" | python3 -c "
import json, sys
d = json.load(sys.stdin)
events = d.get('events', d) if isinstance(d, dict) else d
print(f'venue-events: {len(events) if isinstance(events, list) else 0}')
if isinstance(events, list) and events:
    for e in events[:5]:
        title = e.get('title') or e.get('title_sv') or '?'
        start = e.get('start_time', '?')
        print(f'  - {start[:16]} | {title}')
"
```

Expected:
- HTTP 200
- All events have `venue_id == $VENUE_ID` (server filters)
- Sorted ascending by `start_time`

## Gotchas
- **Requires a venueId in the DB.** If `feed` returns no events with `venue_id`, the drive skips with `skipped: no venue found in feed`. Don't hardcode a venueId.
- **Unknown venueId returns empty list, not 404.** The endpoint is forgiving — that's intentional, but means the drive can't distinguish "no events" from "no such venue" without a follow-up query.
- **venue_id is a UUID.** Treat it as opaque; do not parse or assert format.