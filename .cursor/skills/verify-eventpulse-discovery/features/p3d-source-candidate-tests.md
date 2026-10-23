# P3D-source-candidate-tests

Stänger discovery-loopen som P3A/P3B/P3C lämnade öppen. Claimar kandidater ur
`source_candidate_test_queue`, kör varje genom riktiga A/B/C/D-gates i en
sandbox-miljö, och promote:ar de som klarar smoke-tröskeln.

## Sub-features

- `07-Discovery/src/sourceTesting/runSourceCandidateTests.ts` — CLI. Laddar
  `.env` själv (rad 8), så inga env-vars behöver sättas i shellen.
- `claimCandidates()` via RPC:n `claim_source_candidate_test_queue(task_limit, target_phase)`
- `runSourceCandidateTest()` (`runner.ts:31`) — claim → `toolRunner.run` →
  `decideSourceCandidateOutcome` (`decision.ts`) → ev. promote → insert
- `RealAbcdSourceCandidateRunner.run` (`realToolRunner.ts`) — spawnar
  `Alltools-E2E/e2e.py --from-preA --limit 1 --apply` per kandidat
- `sandbox.ts` — `createSandboxSource`, `promoteSourceCandidate` (skriver
  `sources/<slug>.jsonl` **och** en rad i `runtime/discovery-ui-queue.jsonl`)
- `supabaseRepository.ts` — mappar `passed→verified`, `failed→rejected`,
  annars passthrough av kön status (`supabaseRepository.ts:118`)
- `backfillCandidateCities.ts` — härleder `city` retroaktivt per engine
- migration `20261021-0001` — kötabeller + RPC:er (`WHERE sc.status = 'pending'`)
- migration `20261021-0002` — breddar `source_candidates_status_check` till
  `('pending','tested','verified','promoted','rejected','manual_review')`
- migration `20261021-0003` — `city`-kolumn i båda tabellerna,
  `sync_source_candidate_queue_city()`, 30-minuters stale-reclaim,
  index `idx_source_candidates_city_status_priority`

## How to get to it (user POV)

Användaren ser effekten indirekt: nya rader i `sources/*.jsonl` med
`city: "Stockholm"` — de är det enda som gör att A-gatet kör dem. Utan
stad skriver P3D korrekt och filen är osynlig för resten av systemet.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# Hämta bara de två nycklarna. Sourcing av hela .env FÖRSTÖR: rad 58 är en
# flerradig base64-token som skalet försöker köra som kommando.
export SUPABASE_URL=$(grep -E '^SUPABASE_URL=' .env | cut -d= -f2-)
export SUPABASE_SERVICE_ROLE_KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2-)

# 1. Vad hände i senaste körningen?
jq -c 'select(.event=="step-end" and .step=="P3D-source-candidate-tests")' \
  runtime/ingestion-cron/chain-overview.log | tail -2

# 2. Köhälsa — inklusive fastnat, inte bara status
curl -s "$SUPABASE_URL/rest/v1/source_candidate_test_queue?select=status,locked_at,attempt_count" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq '{byStatus: (group_by(.status) | map({status: .[0].status, n: length})),
         stuck: [.[] | select(.status=="processing"
                 and (.locked_at == null or (.locked_at | fromdate) < (now - 1800)))] | length}'

# 3. Beslut — kolla efter "promote blocked"
curl -s "$SUPABASE_URL/rest/v1/source_candidate_test_decisions?select=decision,reason,promoted_source_id&order=created_at.desc&limit=10" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq '.[] | {decision, promoted_source_id, reason: (.reason[0:60])}'

# 4. Promote:ade filer — bär de city?
tail -5 runtime/discovery-ui-queue.jsonl | jq -c '{sourceId, status, city}'
for id in $(curl -s "$SUPABASE_URL/rest/v1/source_candidate_test_decisions?select=promoted_source_id&decision=eq.promote" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq -r '.[].promoted_source_id' | sort -u); do
  [ -f "sources/$id.jsonl" ] || { echo "SAKNAS $id"; continue; }
  printf '%-42s city=%s\n' "$id" "$(jq -r '.city // "(saknas)"' "sources/$id.jsonl")"
done
```

Bevis: chain-overview step-end + köhälsa utan stuck + beslut utan
"promote blocked" + nya sources-filer med `city`.

## Gotchas

**Bara `phase === 'smoke'` kan ge `promote`.** `decision.ts:60-75` ger
`manual_review` ("requires smoke before promote") eller `reject` för varje
annan fas. `decision.ts:77-83` är det enda `promote`-returnen, gattat på
`eventsPersisted > 0 && eventsAfterNormalization > 0` **i samma smoke-fas**.
Kör `--phase=breadth` för att öka promote-chansen ger noll — breadth kan
aldrig promote:a.

**Konstanten 45/90/65/80 är inte trösklar.** De är `confidenceScore`-
konstanter (`decision.ts:3-6`) som skrivs på beslutsradens
`confidence_score` (`supabaseRepository.ts:55`). Ingen jämförelse i
`decision.ts` testar en kandidat mot dem. Den faktiska promote-gaten är
persisterad+normaliserad, inte ett score-tröskelvärde.

**Två olika `--limit` blandas ihop.** `runSourceCandidateTests.ts:17` är
kandidat-batchens storlek. e2e-körningens `--limit 1` är hårdkodat i
`realToolRunner.ts:65`. `Alltools-E2E --limit=20` existerar inte.

**`--phase=smoke` och `--limit=5`, med likhetstecken.** `argValue()` matchar
`--namn=värde`. Mellanslagsform tyst ignoreras → default `sanity` + `1`, och
`phase='sanity'` kan aldrig promote:a.

**Promote misslyckas tyst och nedgraderar beslutet.** `promoteSourceCandidate`
returnerar `null` vid överlevande slug-kollision (`sandbox.ts:127-133`) och
`runner.ts:80-81` sätter då `decision.decision = 'manual_review'` med reason
`promote blocked: slug collision …`. Sök efter den reason-texten — den
innebär att ett beslut som *hade* varit promote inte skrev någon fil.

**Två slug-strategier, i ordning.** Först den snygga domän-slugen, sedan
`candidate-<id8>-<slug>` om domänen redan upptas av en annan URL. Utan
fallbacken kunde bara EN URL per domän någonsin promote:as.

**`hasCanonicalSourceUrl` hoppar över kandidatens egen post** (`sandbox.ts:93`).
Utan det kan en kandidat aldrig uppdatera sin egen rad — t.ex. sätta `city`
på en tidigare promote.

**Stuck-rader är inte samma sak som `processing`-rader.** En pågående körning
har alltid några `processing`-rader med färsk `locked_at`. Fel är `locked_at`
äldre än 30 min — då dog processen utan att uppdatera (23 sådana rader låg
fast före migration 0003). Doktorn i steg 2 räknar dem explicit; en vanlig
`group_by(.status)` kan inte skilja dem.

**`enqueue_source_candidate_tests` filtrerar på `status = 'pending'` — sedan
0003 även reclaimar stale `processing`.** Den ursprungliga RPC:n
(`20260427-0002`) filtrerade `IN ('candidate','manual_review')`, vilka
aldrig existerade i CHECK-villkoret — den kunde aldrig returnera en rad.

**Två migrationer behövdes för CHECK-villkoret (0001 + 0002), en för
`city`/reclaim (0003).** Postgres auto-genererade
`source_candidates_status_check` som namn på en inline CHECK från
20260911-0002; 0001:s `IF NOT EXISTS`-vakt matchade den vakten mot sitt eget
`IF NOT EXISTS` och körde aldrig ALTER. 0002 gör DROP + ADD.

**Två `--limit` till, `--limit=1` i e2e.** `realToolRunner.ts` spawnar
riktiga nätanrop för VARJE kandidat. Börja lågt.

**Sandbox-tmpdir.** `sandbox.ts` skapar `os.tmpdir()/eventpulse-source-candidate-XXXX/`
per kandidat och sätter `EVENTPULSE_SANDBOX_ROOT` i child-processen. Städas
i `finally` (`runner.ts:92-95`) — även vid kast.

**`curl`-recepten behöver de två nycklarna exporterade först — men
`set -a; . ./.env` ÄR FEL.** Rad 58 i `.env` är en flerradig base64-token;
sourcing av hela filen får skalet att försöka köra den. Använd
`grep -E '^SUPABASE_URL=' .env | cut -d= -f2-` per nyckel. CLI:et laddar
`.env` själv (`runSourceCandidateTests.ts:8`); receptet gör inte det.
`SUPABASE_ACCESS_TOKEN`/`SUPABASE_PAT` (Management-API) är ogiltiga —
`service_role`-nyckeln fungerar för REST.

**`fromdate` vs `fromdateiso8601` i jq.** `locked_at` är ISO-8601 med
timezone. `fromdate` tolkar den som lokal epok och ger fel jämförelse.
Använd `fromdateiso8601`.

**e2e-rapporten är auktoritativ för antal events** (`realToolRunner.ts:readE2eEventsFound`).
Om rapporten finns i `Alltools-E2E/runtime/reports/run-*.json` används
`perSource[].eventsFound` direkt; annars räknas köfilerna. `max()` istället
för ersättning.

**winningPath-logiken prioriterar jsonld först.** `winningPathFromCounts`
(`realToolRunner.ts:174`) provar `postA > 0 || preUI > 0` först, sedan html,
sedan render.