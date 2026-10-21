# P3D-source-candidate-tests

Stänger discovery-loopen som P3A/P3B/P3C hittills lämnade öppen. Claimar kandidater ur `source_candidate_test_queue`, kör varje genom riktiga A/B/C/D-gates i en sandbox-miljö, och promote:ar de som klarar smoke-tröskeln.

## Sub-features

- `07-Discovery/src/sourceTesting/runSourceCandidateTests.ts` — main runner (CLI)
- `claimCandidates` (via `claim_source_candidate_test_queue()`-RPC, `migrations/20261021-0001-source-candidate-test-queue-live.sql`)
- `processCandidate` — claim → `RealAbcdSourceCandidateRunner.run` → `decideSourceCandidateOutcome` (`decision.ts`)
- `runner.ts` — fasstyrning (sanity / breadth / smoke)
- `sandbox.ts` — `seedSandbox`, `promoteSourceCandidate` (skriver `sources/<slug>.jsonl`)
- `realToolRunner.ts` — spawnar `Alltools-E2E/e2e.py --from-preA --limit 1 --apply` per kandidat
- `supabaseRepository.ts` — skriver `status: 'passed'|'failed'` → `'verified'|'rejected'|'manual_review'` på kandidattabellen
- migration `20261021-0001`: skapar kötabeller + RPC:er med `WHERE sc.status = 'pending'` (live-DB saknade dem helt)
- migration `20261021-0002`: breddar `source_candidates_status_check` så 'verified' tillåts (auto-namngiven inline CHECK blockerade skrivning)

## How to get to it (user POV)

Användaren ser effekten indirekt: nya rader i `sources/*.jsonl` (writeable sources), uppdaterad `source_candidates.status`-kolumn (`verified` → A-gate ser källan vid nästa körning; `rejected` → den är märkt; `manual_review` → hamnar i en separat kö).

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Vad hände i senaste körningen? (chain-overview rad)
jq -c 'select(.event=="step-end" and .step=="P3D-source-candidate-tests")' \
  runtime/ingestion-cron/chain-overview.log | tail -2

# 2. Kötillstånd
curl -s "$SUPABASE_URL/rest/v1/source_candidate_test_queue?select=status,phase&limit=200" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq 'group_by(.status) | map({status: .[0].status, count: length})'

# 3. Beslut (verifierade + avvisade)
curl -s "$SUPABASE_URL/rest/v1/source_candidate_test_decisions?select=decision,reason&order=created_at.desc&limit=10" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq

# 4. Kandidater som faktiskt promote:ades (sources/*.jsonl)
ls sources/ | wc -l     # ska vara >antalet från discoverySearch/geoExpansion/rssDiscovery-original
ls sources/ | head -10
```

Bevis: chain-overview step-end + DB-kötillstånd + lista beslut + nya sources-filer.

## Gotchas

**Två RPC:er, en av dem blockerad tidigare.** `enqueue_source_candidate_tests()` (migration 0001) filtrerar `WHERE sc.status = 'pending'` — den status ALLA discovery-producenter lämnar sina rader i. Den ursprungliga migrationen (`20260427-0002`) filtrerade `IN ('candidate','manual_review')`, vilka aldrig existerade i `source_candidates_status_check` — RPC:n kunde alltså aldrig returnera en enda rad.

**Two migrations needed (20261021-0001 + 0002)**, inte en. Postgres auto-genererade `source_candidates_status_check` som namn på en inline CHECK från 20260911-0002; min `IF NOT EXISTS`-vakt i 0001 matchade den vakten mot sitt eget `IF NOT EXISTS` och körde aldrig ALTER. 0002 gör DROP + ADD för att bredda villkoret.

**`Alltools-E2E/e2e.py --from-preA --limit 1 --apply` per kandidat.** `realToolRunner.ts` spawnar riktiga nätanrop för VARJE kandidat. `--limit=1` i smoke = 1 kandidat; `--limit=20` i skarpt läge = upp till 20. Tänk på att varje kandidat kostar ett helt e2e-anrop — börja lågt.

**`--phase=smoke` är enda fasen som kan ge `promote`.** `decision.ts:60,77` använder trösklar 45/90/65/80 som bara sanity/breadth-faserna kan samla in; smoke-fasen ger normalt `manual_review`. Om du vill öka promote-chansen kör `--phase=breadth --limit=5` och inspektera `source_candidate_test_runs` för `events_persisted > 0`.

**Sandbox-tmpdir.** `sandbox.ts` skapar `os.tmpdir()/eventpulse-source-candidate-XXXX/` per kandidat. Den mount:ar `EVENTPULSE_SANDBOX_ROOT=/path` i child-proc, så `runtime/`-skrivningar under e2e hamnar i sandlådan, inte i prod-runtime.

**e2e-rapporten är auktoritativ för antal events** (`realToolRunner.ts:readE2eEventsFound`). Om rapporten finns i `Alltools-E2E/runtime/reports/run-*.json` används `perSource[].eventsFound` direkt; annars räknas köfilerna. `max()` istället för ersättning — en rapport som mäter 0 får inte nollställa en kö-räknad summa.

**winningPath-logiken prioriterar jsonld först.** En A-gate-träff via direkt JSON-LD/API hamnar i `postA-queue.jsonl` (inte UI-köerna). `winningPathFromCounts` (`realToolRunner.ts:174`) provar `postA > 0 || preUI > 0` först, sedan html, sedan render. Tidigare missades `postA` → `winningPath='none'` trots persisterade events.
