# EventPulse Analytics

GDPR-compliant user-activity analytics backend for the EventPulse Expo app.

Runs on port **7778** by default. JSONL persistence (Phase 1); Supabase in Phase 2.

## Quick start

```bash
# from project root
./scripts/start-analytics.sh
# → http://localhost:7778/dashboard
# bearer token is printed to stdout on first boot
```

Open the dashboard with the token:

```
http://localhost:7778/dashboard?token=<bearer>
```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/events` | public | ingest events (single or `{ events: [...] }` batch) |
| POST | `/api/gdpr/erase` | public | right-to-erasure, body `{ device_id_hash }` |
| GET | `/api/gdpr/export?device_id_hash=...` | public | right-to-access |
| GET | `/api/stats/summary` | bearer | counters (total / 24h / devices / retention) |
| GET | `/api/stats/top?limit=10` | bearer | top event types |
| GET | `/api/stats/funnel` | bearer | view → save funnel |
| GET | `/api/stats/devices?limit=20` | bearer | unique devices by recent activity |
| GET | `/api/storage` | bearer | JSONL size + event count |
| GET | `/api/stream` | bearer | SSE change notifications |
| GET | `/dashboard` | bearer | static admin dashboard |
| GET | `/health` | public | liveness |

## Event types

`event_view`, `event_hover`, `event_click`, `event_save`, `event_dismiss`,
`session_start`, `session_end`, `section_impression`, `search_query`, `filter_change`.

Schemas: see `analytics.ts`. No PII. `device_id_hash` is a 64-hex SHA-256.

## GDPR

- No PII collected. `device_id_hash` is treated as pseudonymous.
- Right-to-access: `GET /api/gdpr/export`
- Right-to-erasure: `POST /api/gdpr/erase`
- Right-to-restrict: opt-out via app settings (client-side).
- Retention: 30 days default, configurable via `ANALYTICS_RETENTION_DAYS` (max 365).
- Daily purge job runs at boot and every 24h.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `ANALYTICS_PORT` | `7778` | HTTP port |
| `ANALYTICS_TOKEN` | random | bearer for admin endpoints. Generated if absent. |
| `ANALYTICS_RUNTIME_DIR` | `./runtime` | JSONL storage directory |
| `ANALYTICS_RETENTION_DAYS` | `30` | auto-purge window (1-365) |

## Storage

One JSON line per event at `${ANALYTICS_RUNTIME_DIR}/events.jsonl`.
Reads scan the full file. Acceptable for MVP volumes; Supabase swap is local to `storage.ts`.

## Tests

```bash
cd 10-Analytics
npm test
```