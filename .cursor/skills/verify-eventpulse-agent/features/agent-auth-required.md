# Auth-required endpoints (skipped by this skill)

The following endpoints exist in the Agent API but require a user JWT. This skill does **not** mint JWTs, so drives against these endpoints are recorded as `skipped: auth required`.

| Endpoint | Method | What it does | Why skipped |
|---|---|---|---|
| `/agent/chat` | POST | Main user-agent conversation | Requires a real user JWT; mocking it would prove the wrong thing |
| `/agent/feedback` | POST | Thumbs up/down on a recommendation | Same |
| `/agent/preferences` | POST | User preference update | Same |
| `/agent/follow` | POST/GET | Follow a venue or category | Same |
| `/agent/saved` | GET | List saved events | Same |
| `/agent/notifications` | GET | List notifications | Same |
| `/agent/notifications/read` | POST | Mark a notification read | Same |
| `/agent/attendance` | GET/POST | Track attendance | Same |
| `/agent/rating` | POST | Rate an event | Same |
| `/agent/push-token` | POST | Register device push token | Same |
| `/agent/notification-prefs` | GET/POST | Notification preferences | Same |
| `/agent/outbound` | POST | User-initiated external action (RSVP) | Same |
| `/agent/render` | POST | D-render pilot (admin only) | Admin-gated, source-allowlist |
| `/agent/notifications/scan` | POST | Notification scan (admin only) | Admin-gated |

## How to add a real drive here

When the user provides a JWT (e.g. from `tests/fixtures/test-jwt.txt` or the iOS app's debug menu):

1. Add a feature file per endpoint, modeled on `agent-venue-events.md`.
2. Update `features/README.md`.
3. Drive the endpoint with `Authorization: Bearer $USER_JWT`.
4. The drive must capture BOTH the response and any side-effect (e.g. after `POST /agent/feedback`, `GET /agent/saved` to confirm the row was written).

Until a real JWT is available, this file is the entry that prevents future agents from re-deriving the auth list from scratch.