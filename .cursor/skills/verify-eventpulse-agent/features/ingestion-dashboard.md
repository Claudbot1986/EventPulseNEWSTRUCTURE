# Ingestion supervisor dashboard (port 7777)

## Sub-features
- Exposes ingestion state: per-source health, field coverage, last run summary, freshness
- `GET /api/status` — counts (total / working / dead / untouched), freshness median, field coverage
- `GET /api/ingestion/status` — current process (running, pid, startedAt, lastError)
- Used by the **local** supervisor only (port 7777). Production ingest reports via Supabase `ingestion_runs` table.

## How to get to it (user POV)
The ScrapingSupervisor dashboard at `http://localhost:7777` shows a live tiles view. Each tile reads `/api/status` and `/api/ingestion/status` per refresh.

## Driving it with curl

```bash
DASH_URL="${DASH_URL:-http://localhost:7777}"

# /api/status — counters + field coverage
curl -fsS --max-time 10 "$DASH_URL/api/status" | python3 -c "
import json, sys
d = json.load(sys.stdin)
srcs = d.get('sources', {})
cov = d.get('fieldCoverage', {})
print(f'sources total/working/dead/untouched: {srcs.get(\"total\")}/{srcs.get(\"working\")}/{srcs.get(\"dead\")}/{srcs.get(\"untouched\")}')
print(f'freshnessMedianHours: {d.get(\"freshnessMedianHours\")}')
print(f'field coverage title/date/venue/description: {cov.get(\"title\")}/{cov.get(\"date\")}/{cov.get(\"venue\")}/{cov.get(\"description\")}')
"

# /api/ingestion/status — current process state
curl -fsS --max-time 10 "$DASH_URL/api/ingestion/status" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'running={d.get(\"running\")} pid={d.get(\"pid\")} startedAt={d.get(\"startedAt\")}')
print(f'lastError={d.get(\"lastError\")}')
"
```

Expected:
- `/api/status` returns counters and a `generatedAt` field
- `/api/ingestion/status` returns either `{running: false}` (no run) or `{running: true, pid, startedAt}` (a run in flight)

## Gotchas
- **0/0 attempts in dashboard does not mean ingestion is broken.** Known bug: `runDaily.ts:173-177` hardcodes `attempts/ok/skipped/failed = 0/0/0/0` in the run-summary it writes. The ingestion itself is working (events land in DB nightly). Track via Supabase `ingestion_runs.created_at` and `events.created_at` instead.
- **Dashboard is local-only.** There is no public ingestion status endpoint. Fly.io's agent does not proxy this.
- **This skill uses the helper `scripts/ingestion-snapshot.sh`** which captures both endpoints to `runtime/verification-reports/ingestion-snapshot-<TS>.json`. Run it as a periodic evidence capture.
- **Source-state counts come from `observations`** — a single crawl failure transitions a source from `working` to `dead`, and `last_observed_at` resets. `untouched` means the source has been registered but never run.