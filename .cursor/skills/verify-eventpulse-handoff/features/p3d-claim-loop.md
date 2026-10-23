# Kandidatlivscykel i DB

## Sub-features

- **`source_candidates`** — producenterna (P3A `discoverySearch.ts`,
  P3B `geoExpansion.ts`, P3C `rssDiscovery.ts`) skriver här.
  Kolumner som betyder något: `id`, `url`, `city`, `engine`, `source_query`,
  `status`.
- **`source_candidate_test_queue`** — spegel med teststatus. Kolumner:
  `id`, `source_candidate_id`, `candidate_url`, `candidate_name`,
  `origin_path`, `phase`, `status`, `priority_score`, `attempt_count`,
  `locked_at`, `last_error`, `created_at`, `updated_at`, `city`.
  `city` lades till i migration `20261021-0003`.
- **`claim_source_candidate_test_queue(task_limit, target_phase)`** — RPC som claimar och sätter
  `locked_at`. Stöder stale-reclaim (kö-health.md).
- **`source_candidate_test_runs`** — evidens per körning (eventsFoundTotal,
  eventsAfterNormalization, eventsPersisted, winningPath, errors, riskFlags).
- **`source_candidate_test_decisions`** — kolumner: `decision`
  (`promote`/`reject`/`manual_review`), `reason`, `confidence_score`,
  `evidence_run_id`, **`promoted_source_id`**, `created_at`.
- **Faser** — `sanity` (default) → `breadth` → `smoke`. Endast `smoke` kan
  ge `promote` (`decision.ts:59`).

## How to get to it (user POV)

Du har kört P3A och ser 459 nya kandidater i databasen, men A-gatet kör
fortfarande inga nya källor. Du vill veta var i kedjan de fastnar: ligger de
i `source_candidates` men aldrig i test-kön, eller i kön men aldrig claimade,
eller testade men aldrig beslutade?

## Driving it

```bash
cd /Users/claudgashi/EventPulse
DBQ=".cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs"

# Var ligger massan?
node "$DBQ" "SELECT status, count(*)::int AS n FROM source_candidates GROUP BY 1 ORDER BY 2 DESC"

# Är de i test-kön?
node "$DBQ" "SELECT status, count(*)::int AS n FROM source_candidate_test_queue GROUP BY 1 ORDER BY 2 DESC"

# Finns det kandidater som producerats men aldrig enqueue:ats?
node "$DBQ" "SELECT count(*)::int AS n FROM source_candidates sc
  WHERE NOT EXISTS (SELECT 1 FROM source_candidate_test_queue q
                     WHERE q.source_candidate_id = sc.id)"

# Finns det beslut utan motsvarande fil?
node "$DBQ" "SELECT d.decision, count(*)::int AS n,
                    count(d.promoted_source_id)::int AS with_source_id
               FROM source_candidate_test_decisions d GROUP BY 1 ORDER BY 2 DESC"

# Vad sa de senaste besluten varför?
node "$DBQ" "SELECT decision, left(reason, 72) AS reason, created_at
               FROM source_candidate_test_decisions ORDER BY created_at DESC LIMIT 12"
```

## Gotchas

**`source_candidates.status` och `source_candidate_test_queue.status` har
olika värdeuppsättningar.** Kandidattabellen har CHECK
`('pending','tested','promoted','rejected')`; kön har
`('pending','processing','passed','failed','manual_review')`. En
`enqueue_source_candidate_tests()` som filtrerar på `status IN ('candidate',
'manual_review')` kan aldrig returnera en rad — det var hård blockeraren före
2026-10-21.

**`promote` utan `promoted_source_id` betyder att promote inte skrevs.**
`runner.ts:75-82` sätter fältet bara när `promoteSourceCandidate` returnerar
en id. Ett `promote`-beslut med `promoted_source_id IS NULL` är en motsägelse
— rapportera den, inte kör den förbi.

**`manual_review` är inte `reject`.** `manual_review` betyder "vi vill inte
gissa" (smoke persisterade 0 events, eller riskflaggor, eller en icke-smoke
fase med signal). `reject` betyder "nej, helt". Behandla dem olika i rapporter.

**Köstatus ≠ kandidatstatus.** En kandidat kan stå som `pending` i
`source_candidates` och `passed` i kön. Koppla på `source_candidate_id`.

**Testkörningen är dyr.** `RealAbcdSourceCandidateRunner` spawnar
`Alltools-E2E/e2e.py --from-preA --limit 1 --apply` per kandidat — riktiga
gaten, riktigt nätverk. `--limit=1` i drift, inte `--limit=50`.

**`--phase` är `--phase=smoke`, `--limit` är `--limit=5`.**
`argValue()` (`runSourceCandidateTests.ts:9-11`) matchar `--namn=värde`.
Mellanslagsform tyst ignoreras och defaulten (`sanity`, `1`) används — med
`phase='sanity'` kan beslutet aldrig bli `promote`. Om din körning ger
`manual_review` med "requires smoke before promote", det är det här.

**Ingen konsol-logg om inget claimades.** Loopen `for (const item of claimed)`
skriver bara en rad per kandidat. En tom utdata betyder antingen tom kö eller
att RPC:n returnerade noll — skilj med en count-fråga, inte med utdata.