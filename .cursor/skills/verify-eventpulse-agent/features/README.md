# verify-eventpulse-agent/features — index

Detta är feature-map för agent-API:t + ingestion-supervisorn. Speglar route- och tool-inventariet i `08-Agent/server.ts` + `08-Agent/tools/` + ScrapingSupervisor-routes.

| Route | Tool | Feature-fil | Status |
|---|---|---|---|
| `POST /agent/chat` | parse_intent → search_events → rank_events → diversify → composeReply | `agent-chat.md` | live (Phase 0/1) |
| `GET /agent/feed` | feed_events (+ optionalUser) | `agent-feed.md` | live |
| `GET /agent/live-now` | live_now | `agent-live-now.md` | live |
| `GET /agent/venues/:venueId/events` | venue_events | `agent-venue-events.md` | live |
| `GET /agent/health` | – | `agent-health.md` | live |
| `POST /agent/saved` | get_saved_events / record_feedback | `agent-auth-required.md` | behind user-auth |
| `POST /agent/follow` | follow_entity | `agent-auth-required.md` | behind user-auth |
| `GET/POST /agent/notifications` | notification_center | `agent-auth-required.md` | behind user-auth |
| `POST /agent/outbound` | attribution | `agent-auth-required.md` | behind user-auth |
| `POST /agent/feedback` | record_feedback | `agent-auth-required.md` | behind user-auth |
| `POST /agent/render` | D-render pilot | `agent-auth-required.md` | behind admin-gate |
| `GET /agent/metrics` | internal | `agent-auth-required.md` | behind admin-gate |
| `GET /api/status` (port 7777) | supervisor | `ingestion-dashboard.md` | local-only |
| `GET /api/ingestion/status` (port 7777) | supervisor | `ingestion-dashboard.md` | local-only |

Cross-cutting som INTE blir egna feature-filer:
- Middleware i `08-Agent/middleware/` (adminAuth, requireUser, optionalUser, rateLimit, ai_image_*) — verifieras inom varje route-feature.
- Cron workers i `08-Agent/cron/` — egen yta, bevakas inte här (skulle bli `verify-eventpulse-cron` om det efterfrågas).
- Workers i `08-Agent/workers/` — egen yta.

Varje feature-fil har fyra H2:er: `Sub-features`, `How to get to it (user POV)`, `Driving it with curl`, `Gotchas`. Drift i någon av dessa är `verify-eventpulse-agent`-skillens ansvar. Produktkod-drift rapporteras separat och hålls utanför denna PR.