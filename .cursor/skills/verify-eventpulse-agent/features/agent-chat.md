# agent-chat — feature #3 wire / API-yta

Speglar `06-UI/FEATURE_MAP.md` § 3 ur API-perspektivet. Headline-routen på agent-servern. Deterministisk pipeline i Phase 0: `parse_intent → search_events → rank_events → diversify → composeReply → record_interaction → respond`. Phase 1 lägger till `requireUser`-auth.

## Sub-features

- **Intent-parsning** — `08-Agent/tools/parse_intent.ts` → `IntentBrief`. Språkdetektering sv/en, tidsuttryck via `temporal_sv.ts`, kategori-detektering, budget, party-size.
- **Event-sökning** — `search_events.ts` mot Supabase `events_public` (med venue-join och kategori-filter).
- **Ranking** — `rank_events.ts` (Reasons från `RankReason`-unionen i `08-Agent/types.ts:33-51`). MMR-rerank via `diversify.ts`.
- **Slot-reservation** — `explore_reserve.ts` (fas C, behåller 20 % Hem-flödet ledigt).
- **Reply-komposition** — `composeReply` i `08-Agent/llmRouter.ts`. Utan `MINIMAX_API_KEY` → deterministisk template. Med key → LLM.
- **Interaction logging** — `record_interaction` sparar `client_user_id`, `event_id`, `rank_reason`-lista till `agent_interactions`.
- **Personalisering** — `personalize.ts` (load stated preferences + locale). Fas 2-experiment: `experiments.ts` PERSONALIZATION_PRIORS.
- **Clarifying question** — `find_gaps.ts`/`pickClarifyingQuestion`. Bifogas vid sidan av cards, **aldrig istället för cards** (MASTERPLAN §18.4 DoD).

## How to get to it (user POV)

1. Öppna appen, logga in (eller kör som anonym).
2. Gå till **Agent**-tabben (eller skriv i chat-rutan på Hem / AgentScreen).
3. Skriv en svensk eller engelsk fri-text-fråga.
4. Tryck skicka. Förväntat svar inom ~1–3 s (utan LLM).
5. Kort-listan visas (3–5 kort). Varje kort har titel, venue, datum, primär CTA.

För API-drives (curl) når du samma flow via `POST /agent/chat { message, client_user_id }` utan UI. Använd Phase 0 (utan Bearer) för första regressionen — den är auth-fri och stabil.

## Driving it with curl

### Drive 1: Magic query (MASTERPLAN §1, §18.2 DoD)

```bash
URL="${AGENT_URL:-http://localhost:8787}"
BODY='{"client_user_id":"00000000-0000-4000-8000-000000000001","message":"live musik på fredag kväll, max 400 kr, gärna med en vän, inte arena"}'

curl -s -X POST "$URL/agent/chat" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:9090" \
  -d "$BODY" | tee /tmp/agent-chat-drive1.json | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert 'cards' in r, 'cards missing'
assert len(r['cards']) >= 3, f'expected >=3 cards, got {len(r[\"cards\"])}'
for c in r['cards']:
    assert c.get('venue_name'), f'card missing venue_name: {c}'
    assert c.get('title'), f'card missing title: {c}'
# At most ONE clarifying question, never in place of cards
if 'clarifying_question' in r and r['clarifying_question']:
    assert len(r['cards']) > 0, 'clarifying question replaces cards (regression)'
print('PASS')
"
```

`origin: http://localhost:9090` krävs för att passera CORS — annars 403. Om `AGENT_ALLOWED_ORIGINS` inte innehåller `http://localhost:9090` lägg till det vid launch.

### Drive 2: Golden-eval scenario (Q01–Q23+)

Driv över alla Q-scenarios från `08-Agent/tests/golden-eval.json`:

```bash
URL="${AGENT_URL:-http://localhost:8787}"
python3 - <<'PY'
import json, os, urllib.request, re
url = os.environ.get('AGENT_URL', 'http://localhost:8787') + '/agent/chat'
gold = json.load(open('08-Agent/tests/golden-eval.json'))
origin = os.environ.get('AGENT_ORIGIN', 'http://localhost:9090')
results = []
for q in gold:
    body = json.dumps({
        'client_user_id': f"00000000-0000-4000-8000-{int(q['id'][1:]):012d}",
        'message': q['query'],
    }).encode()
    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json',
        'Origin': origin,
    })
    resp = json.loads(urllib.request.urlopen(req).read())
    cards = resp.get('cards', [])
    if 'expected_min_results' in q:
        ok = len(cards) >= q['expected_min_results']
    else:
        ok = len(cards) >= 0
    results.append((q['id'], ok, len(cards)))
print(f"Golden-eval: {sum(r[1] for r in results)}/{len(results)} pass")
for qid, ok, n in results:
    flag = 'PASS' if ok else 'FAIL'
    print(f'  [{flag}] {qid}: cards={n}')
PY
```

Förväntat: 23/23 PASS om Supabase har Stockholm-events. Om några Q blir FAIL → lägg till i Gotchas i denna feature-fil (drift i sökning eller parsning). Jämför trender mellan körningar — samma Q ska vara stabil om inte schema ändrats.

### Drive 3: Origin-blocket

Verifiera att CORS-gate fungerar:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:8787/agent/chat \
  -H "Content-Type: application/json" \
  -H "Origin: https://evil.example.com" \
  -d '{"client_user_id":"00000000-0000-4000-8000-000000000099","message":"test"}'
# → förväntat: 403 (om AGENT_ALLOWED_ORIGINS inte innehåller evil.example.com)
```

### Drive 4: Rate-limit

Verifiera att rate-limiter triggar:

```bash
# chatLimiter: 5 rps / burst 20
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:8787/agent/chat \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:9090" \
    -d "{\"client_user_id\":\"00000000-0000-4000-8000-000000000099\",\"message\":\"q$i\"}")
  echo "$i $STATUS"
done | tail -5
# → förväntat: tidiga 200, sena 429 (429 = Too Many Requests)
```

För vitest-driven regression (utan rate-limit, med mock-Supabase) använd `08-Agent/tests/agent_chat_wire.test.ts` som referens. Kör `npx vitest run 08-Agent/tests/agent_chat_wire.test.ts` parallellt.

## Gotchas

**Phase 0 vs Phase 1 beter sig olika.** Phase 0 chat kräver ingen Bearer. Phase 1 chat kräver Bearer (eller får 401). `/agent/health` visar `phase: 0` tills vidare — bekräfta vilken fas agent-processen är i innan du kör drives. Bygger på `08-Agent/server.ts` build-flagga eller feature-toggle.

**Deterministisk path förutsätter att `MINIMAX_API_KEY` är unset.** Vitest-wiren tvingar detta genom `delete process.env.MINIMAX_API_KEY;` vid toppen av filen. Curl-drives körs i subshell — låt bli att exportera nyckeln i samma session. Om LLM-path triggas kan responses variera mellan körningar och golden-eval blir icke-deterministisk.

**`client_user_id` måste vara UUID.** Wire-formatet kräver det (se `UUID_RE` i `08-Agent/server.ts:82`). Skicka kolliderande ID:n i golden-eval-loopen undviks genom att använda Q-ID som suffix.

**A/B-experiment kan flippa ranking.** Samma query från olika `client_user_id` kan ge olika ordning (PERSONALIZATION_PRIORS). Drives med samma id blir stabila; drives med olika id:n kan visa andra-rank-ordning. Det är korrekt beteende, inte regression.

**Side-effects är globala.** `record_interaction` skriver rader i `agent_interactions` för varje drive. Mellan tester, antingen räkna rader före/efter och subtrahera (clean driving) eller spola tabellen i en test-only-instans.

**`/agent/render` är admin-gated.** Driv bara med `X-Admin-Token: $AGENT_ADMIN_TOKEN`. Även då — source-specifik allowlist (5 sourceIds). Att driva med en sourceId som inte finns i allowlist → 400 eller 403. Att driva utan token → 503 (om `AGENT_ADMIN_TOKEN` ej satt) eller 401.

**Supabase `events_public`-innehåll.** Tomt rum = 0 kort på alla golden-eval-scores. Det är *korrekt* serversvar, inte regression — drives ska rapportera `0 cards` om DB är tom, inte flaga som PASS/FAIL på detta.

**Bifogade `chatLimiter` mid-drive.** Mellan drive 1, 2, 3, 4 — sleep 0.5 s för att inte bränna budget och trigga 429 under andra loopen.

**Network-mock via `buildApp({ supabase, verify })`.** Om live-drives är för tunga (Supabase latency, rate-limit) växla till vitest-wire. Samma pipeline körs mot injicerad mock, ingen rate-limit, ingen Supabase IO. Wire-format-identitet garanteras av att samma `server.ts`-kod används.
