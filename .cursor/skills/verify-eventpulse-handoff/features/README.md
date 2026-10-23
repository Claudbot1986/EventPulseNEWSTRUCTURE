# verify-eventpulse-handoff/features — index

Feature-map för sömsen mellan discovery och ingestion: hur en kandidat som
P3A/P3B/P3C hittade blir en fil i `sources/` som A-gatet faktiskt kör.

| Feature | Fil | Var |
|---|---|---|
| Kandidatlivscykel i DB | `p3d-claim-loop.md` | `runSourceCandidateTests.ts`, `supabaseRepository.ts`, `decision.ts`, `phases.ts` |
| Promote till `sources/*.jsonl` | `promote-to-sources.md` | `sandbox.ts`, `runner.ts`, `discoveryUiQueue.ts` |
| Stadens väg genom kedjan | `city-carry-through.md` | `discoverySearch.ts`, `geoExpansion.ts`, `rssDiscovery.ts`, migration `20261021-0003` |
| Bryggan till A-gatet | `scope-reachability.md` | `sourceRegistry.ts:150`, `runA.ts:251-288` |
| Köhälsa och backfill | `queue-health.md` | `claim_source_candidate_test_queue(task_limit, target_phase)`, `backfillCandidateCities.ts` |

Varje feature-fil har fyra H2:er: `Sub-features`, `How to get to it (user POV)`,
`Driving it`, `Gotchas`.

## Kedjan i en rad

```
source_candidates ──enqueue RPC──▶ source_candidate_test_queue
   (city)                             (city)
        │                                   │ claim RPC (locked_at)
        │                                   ▼
        │                        P3D: sandbox + Alltools-E2E/e2e.py --from-preA
        │                                   │  → source_candidate_test_runs
        │                                   ▼
        │                        source_candidate_test_decisions
        │                                   │ decision='promote'
        ▼                                   ▼
     sources/<slug>.jsonl  ◄──── sandbox.ts:promoteSourceCandidate
     (city = "Stockholm")                  + runtime/discovery-ui-queue.jsonl
        │
        ▼
   isInScope() = city === 'Stockholm'   ← detta är sömsen
        │
        ▼
   A-gatet: getSourceStatus(id) === 'never_run'  →  kör  →  events
```

## Vad beviset är

Tre leder i samma mening: **beslut** (`decision='promote'` i DB) →
**fil** (`sources/<id>.jsonl` med `city: "Stockholm"`) → **körning**
(samma `sourceId` med `status: 'success'` eller `lastEventsFound > 0` i
`runtime/sources_status.jsonl`).

En förlorad led är ett verkligt fel. Alla tre gröna = kedjan håller.

## Mätt tillstånd (2026-10-23)

459 kandidater (342 `exa_search`, 77 `venue_graph_geo`, 40 `rss_discovery`) —
199 med stad, 151 Stockholm. Kö: 421 pending, 13 passed, 24 failed,
1 manual_review, 0 stuck. Beslut: 16 promote, 24 reject, 5 manual_review,
3 promote-blocked. Disk: 246 filer, 141 med `city: "Stockholm"`, 14 rader i
`discovery-ui-queue.jsonl`.

**Kända ärliga brister, inte buggar:** 260 köposter har `city IS NULL`
(går inte att härleda i efterhand — Exa-vägen slog ihop frågelistan). Tre
kandidaters stad är operatörsatt av en människa, inte härledd.

## Cross-refs

- Gaten A/B/C/D/I själva ligger i `verify-eventpulse`.
- Producenterna P3A/P3B/P3C ligger i `verify-eventpulse-discovery`.
- Dashboard-läsning av cron-status ligger i `verify-eventpulse-agent`.

**Senast uppdaterad (2026-10-23, create-pass):** 5 feature-filer + SKILL.md +
`doctor-handoff.mjs` + `dbq.mjs`, efter fix-setet som gjorde promoteade
källor nåbara för ingestion.