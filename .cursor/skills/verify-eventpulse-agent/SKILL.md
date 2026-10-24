---
name: verify-eventpulse-agent
description: |
  Drive the EventPulse private agent API (08-Agent, Express + Supabase)
  end to end via curl and JSON assertions. Use for /verify-eventpulse-agent,
  when an agent-API tool or route in 08-Agent/tools/ needs evidence, or
  when a golden-eval scenario in 08-Agent/tests/golden-eval.json regresses.
  Covers POST /agent/chat (deterministic Phase 0 pipeline), /agent/feed,
  /agent/saved, /agent/follow, /agent/notifications, /agent/feedback,
  /agent/outbound, /agent/render (admin-gated), /agent/metrics (admin),
  /agent/health. LLM-routing i llmRouter.ts nås via /agent/chat med
  MINIMAX_API_KEY satt (utvalda drives).
disable-model-invocation: false
---

# verify-eventpulse-agent

## Launch

Agent-server: Express + Supabase via service-role. Startas från projekt-roten.

```bash
# root-package.json:scripts.start:agent → tsx 08-Agent/server.ts
AGENT_PORT=8787 \
AGENT_ALLOWED_ORIGINS="http://localhost:9090,http://localhost:8787" \
AGENT_ADMIN_TOKEN="$AGENT_ADMIN_TOKEN" \
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
npx tsx 08-Agent/server.ts
```

Ready-signal: stdout-raden `[08-Agent] listening on :8787`. Bekräfta med:

```bash
curl -s http://localhost:8787/agent/health
# → förväntat: {"ok":true,"phase":0}
```

dotenv: `08-Agent/server.ts` importerar `dotenv/config` först i filen, så alla env vars i `.env` läses automatiskt — de explicita `KEY=val`-prefixen ovan är för tydlighet och för att överrida vid behov.

Isolering: en agent-process äger AGENT_PORT. Två instanser kräver olika portar — `AGENT_PORT=8788` för den andra, parallella curl:ar med rätt URL. Att köra två mot samma 8787 race:ar om Supabase service-role-räknare och rate-limiter state.

Env vars som styr beteende:

| Var | Effekt |
|---|---|
| `AGENT_PORT` | lyssnarport (default 8787) |
| `AGENT_ALLOWED_ORIGINS` | CSV, tom sträng = ingen CORS-block |
| `AGENT_ADMIN_TOKEN` | gate för `/agent/metrics`, `/agent/experiments/*`, `/agent/render`. Saknas → 503 på alla admin-routes. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | obligatoriska |
| `MINIMAX_API_KEY` | om satt, llmRouter använder LLM. Annars deterministic fallback (template). Drives börjar alltid utan nyckel för att nå den deterministiska pathen — se Gotchas. |

## Doctor

```bash
# Health reachable?
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/agent/health
# → förväntat: 200

# Body correct?
curl -s http://localhost:8787/agent/health | grep -q '"ok":true' && echo OK
# → förväntat: OK

# Origin-handtering aktiv? (annars drives funkar men CORS-blockerar webbdrives)
curl -s -H "Origin: http://localhost:9090" -o /dev/null -w "%{http_code}\n" \
  http://localhost:8787/agent/health
# → förväntat: 200 (om 9090 finns i AGENT_ALLOWED_ORIGINS) eller 403 (om inte)

# Admin-gate aktivt? (skyddade routes ska inte 200:a utan token)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/agent/metrics
# → förväntat: 401, 403 eller 503 beroende på gate-implementation. ALDRIG 200 med data.
```

Doctor-failure = instansen inte värd att driva. Stoppa, relaunch.

## Drive

Harness: `curl` + JSON-parsing (Node `JSON.parse` eller `jq` om installerat). Verifiera wire-format, content-shape, status codes, side-effects i Supabase.

Stabila handtag:
- HTTP-metod (`POST /agent/chat`, `GET /agent/saved`, …)
- Wire-keys lästa ur `08-Agent/types.ts` (`EventCard`, `AgentChatResponse`, `IntentBrief`, …)
- Status codes från `08-Agent/server.ts` (200, 202, 400, 401, 403, 429, 500, 503)
- Origin-header matchad mot `AGENT_ALLOWED_ORIGINS`

Driv-mönster (en chat-drive):

```bash
# 1. Bygg body
BODY='{"client_user_id":"00000000-0000-4000-8000-000000000001","message":"Jazz ikväll"}'

# 2. Skicka
curl -s -X POST http://localhost:8787/agent/chat \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:9090" \
  -d "$BODY"

# 3. Assert
RESP=$(curl -s -X POST http://localhost:8787/agent/chat \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:9090" \
  -d "$BODY")

echo "$RESP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
assert isinstance(data.get('cards'), list), 'cards missing'
for card in data['cards']:
    assert card.get('venue_name'), f'card has no venue_name: {card}'
print(f'OK: {len(data[\"cards\"])} cards, first venue_name={data[\"cards\"][0][\"venue_name\"]}')
"
```

För user-scoped routes (`/agent/saved`, `/agent/feedback`, …) krävs Bearer-JWT. För tests utan auth, använd vitest-mönstret i `08-Agent/tests/agent_chat_wire.test.ts` (inject mock-Supabase + mock-verifier) istället för curl.

För admin-routes: bifoga `X-Admin-Token: $AGENT_ADMIN_TOKEN` (eller den header `08-Agent/middleware/adminAuth.ts` kräver — läs filen).

## Evidence

- **Wire-loggar:** `agent-runs/<scenario>-<ts>.jsonl` — varje drive skriver ett JSON-rad med method, URL, request-body, response-status, response-body.
- **Supabase side-effects:** antal rader i `agent_sessions`, `agent_messages`, `agent_interactions`, `user_preferences`, `notifications` (tabellnamn verifieras via metadata-query innan drive). `count(*)` före, kör drive, `count(*)` efter.
- **Test-körningar:** `08-Agent/tests/` kan återköras parallellt med curl-drives. `npx vitest run 08-Agent/tests/agent_chat_wire.test.ts` validerar wire-format utan nätverk.
- **Golden-eval:** `08-Agent/tests/golden-eval.json` är scenarierna — drives ska täcka Q01–Q23+. Saknas en Q-scenario här eller i filen → drift.

Bevisstandard: kör mot riktig Supabase-instans eller mock som injicerats via `buildApp({ supabase, verify })`. Inga syntetiska fixtures som låtsas vara svar. Verifiera både response shape OCH sidledes-effekt (rad i tabell X).

## Cleanup

```bash
PID=$(cat .runtime-agent.pid 2>/dev/null)
[ -n "$PID" ] && kill "$PID"
rm -f .runtime-agent.pid
```

Bevis (agent-runs/, vitest-rapport, JSONL) lämnas intakta. Vitest-rapport i `08-Agent/reports/` är redan gitignored. `agent-runs/` läggs i `.gitignore` vid första körning.

## Helpers

Klart:

- `scripts/doctor.sh` — kör Doctor-blocket (agent `/agent/health` + dash `/api/status`), skriver `runtime/verification-reports/doctor-<TS>.json`.
- `scripts/quick-feed.sh` — kör `/agent/feed` (default 7d + music 30d) och skriver `runtime/verification-reports/agent-feed-<TS>.json`. Används som fristående evidence-capture.
- `scripts/ingestion-snapshot.sh` — kör `/api/status` + `/api/ingestion/status` på lokala dashboarden (port 7777), skriver `runtime/verification-reports/ingestion-snapshot-<TS>.json`. Spelar in ingestion-state utan att starta en körning.

Planerade:

- `scripts/golden-eval.sh` — loopar över `08-Agent/tests/golden-eval.json` Q01–Q23+, kör varje som drive mot live `/agent/chat`.
- `scripts/cleanup-agent.sh` — dödar PID.

## Gotchas

**`MINIMAX_API_KEY` måste vara unset för deterministisk path.** Sätts den → llmRouter tar LLM-vägen, drives blir icke-reproducerbara. `08-Agent/tests/agent_chat_wire.test.ts:26` har `delete process.env.MINIMAX_API_KEY;` — kopiera det mönstret i alla curl-drives om du vill ha stabil regression.

**Origin-handtering tillåter tom sträng.** Om `AGENT_ALLOWED_ORIGINS=""` (eller ej satt) tillåts alla origins. Det är en bekvämlighet för dev men låter anonyma web-origins träffa `/agent/health` och läs-routes. Drives kan utnyttja det, men produktionslika tester bör sätta strikt allowlist.

**Rate-limit:** `chatLimiter` = 5 rps / burst 20, `generalLimiter` = 10 rps / burst 40. Drives som loopar över 30+ scenarios måste sova eller så triggas 429. Lägg `sleep 0.3` mellan curls eller använd en test-injector (`buildApp({ supabase, verify })`) som bypassar rate-limiter.

**`requireUser`-gate.** User-scoped routes (chat, saved, feedback, follow, …) kräver Bearer-JWT. Vitest-wires testar med injicerad `verify`-mock. Curl-drives mot dessa kräver antingen en riktig test-användare (extrahera JWT ur Supabase auth) eller så annoterar du drivet som `verified-partial` (route-shape OK, auth-guard bekräftad genom 401-svar).

**`optionalUser` på `/agent/feed`.** Fas C (2026-09-23) — feed funkar utan auth, men bifogar `req.user` om Bearer finns. Drives med och utan Bearer ska båda returnera 200 men kan skilja i body. Kontrollera skillnaden explicit.

**A/B-experiment:** `PERSONALIZATION_PRIORS_EXP` är sticky per `client_user_id`. Använd olika client_user_ids i varje drive annars låses assignment. Salt-byte innebär ny randomisering — använd det i regression-test om du vill testa båda varianterna.

**Supabase-byten är global state:** service-role klienten är en singleton (se `getSupabase()` rad 138–147). Mellan tester, antingen återanvänd eller starta om processen.

**Phase 0 / Phase 1:** `phase` i `/agent/health` visar implementationens fas. Phase 0 = deterministic pipeline, Phase 1 = auth på. Drives ska vara fase-medvetna — Phase 0.chat kräver ingen auth, Phase 1.chat kräver Bearer.

## Maintenance

Kör `/maintain-verification-skill` när något händer:
- Ny tool i `08-Agent/tools/` eller befintlig ändrar sin signatur.
- Nya routes registreras i `server.ts` (route → tool mapping ändras).
- `golden-eval.json` lägger till eller ändrar Q-scenarios.
- Wire-shape ändras (`08-Agent/types.ts`).
- ScrapingSupervisorn lägger till / tar bort routes (då uppdatera `features/ingestion-dashboard.md`).

Source-wave granskar varje feature-fil mot tool-källkod. Live-pass driver alla user-scoped + open routes, plus spot-checks admin-routes med token.

## Feature map

Spegel av route- och tool-inventariet. Se `features/README.md` för index.

| Route | Feature-fil |
|---|---|
| `POST /agent/chat` | `agent-chat.md` |
| `GET /agent/feed` | `agent-feed.md` |
| `GET /agent/live-now` | `agent-live-now.md` |
| `GET /agent/venues/:venueId/events` | `agent-venue-events.md` |
| `GET /agent/health` | `agent-health.md` |
| Auth-gated + admin-gated routes | `agent-auth-required.md` |
| Supervisor `7777` dashboard | `ingestion-dashboard.md` |
