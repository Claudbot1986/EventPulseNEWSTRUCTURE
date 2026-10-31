# Discovery-handoff — hittar discovery nya källor, och kommer de till ingestion?

## Sub-features

- **P3A** (`07-Discovery/src/searchEngines/discoverySearch.ts`) — Exa-sök →
  `source_candidates`.
- **P3B** (`venueGraph/geoExpansion.ts`) — venue-graph-geografi.
- **P3C** (`searchEngines/rssDiscovery.ts`) — RSS-läsning.
- **P3D** (`sourceTesting/runSourceCandidateTests.ts`) — testar kandidater med
  den riktiga A/B/C/D-gaten (`Alltools-E2E/e2e.py`) och beslutar promote/reject.
- **Promote** (`sourceTesting/sandbox.ts`) — skriver `sources/<slug>.jsonl` och
  `runtime/discovery-ui-queue.jsonl`.
- **09-DiscoveryAgent** — separat agent (heal/promote/expand) mot
  `runtime/discovery-candidates.jsonl`. Promote skriver också
  `sources/<slug>.jsonl`, men expand körs bara på måndagar.

## How to get to it (user POV)

Operatören ser promote-listan i `runtime/discovery-ui-queue.jsonl` och de nya
källfilerna i `sources/`. Från dem förväntar sig agenten att nya evenemang
kommer in i appen.

## Driving it with <harness>

```bash
cd /Users/claudgashi/EventPulse
node scripts/verify-discovery-handoff.mjs --state-only   # bara D1
node scripts/verify-discovery-handoff.mjs --limit 5       # 5 kandidater, riktig gate
```

Gaterna (D1–D4) finns i SKILL.md. Kort version:

- **D1** — kön är matad: pending Stockholm-kandidater finns, alla finns i kön,
  och kön har claimbara rader (`status='pending'` + `city='Stockholm'`).
- **D2/D3** — P3D claimar och testar med `e2e.py`; beslut sparas i
  `source_candidate_test_decisions`.
- **D4** — promote skrev `sources/<slug>.jsonl` med `city=Stockholm` och syns i
  `runtime/discovery-ui-queue.jsonl`.

## Gotchas

- **"Inga events" är inte samma som "trasig".** De flesta Exa-träffar är
  väggar eller redan kända källor; `decision: reject` är ett legitimt utfall.
  Gaten blir röd först när *mekaniken* är trasig (0 claimade, inga beslut, ingen
  fil).
- **Claim-funktionen filtrerar på `city='Stockholm'`.** En kö-rad med
  `city=NULL` är oclaimbar — det var 215 rader i detta tillstånd den
  2026-10-31. `sync_source_candidate_queue_city()` lagar dem.
- **Enqueue-funktionen anropas av ingen kod före fixen.** Utan
  `enqueue_source_candidate_tests()` är kön fryst.
- **Filnamnsmönstret är `candidate-<hash>-<slug>.jsonl` bara för äldre
  promote:er.** Sedan 2026-10-24 får en kandidat domän-slugen
  (`nalencom.jsonl`), och en URL på en befintlig domän läggs som
  `metadata.eventUrls` i stället för en egen fil. Läs därför
  `promoted_source_id` ur beslutsraden — gissa inte filnamnet.
- **Varje kandidat tar ~2,5 min** (Scrapingbee-render). 20 kandidater ≈ 50 min.
- **P3D kör före A-gaten i kedjan** (P3-stegen är splice:ade först), så en
  promote:ad källa kan nå A-gaten samma natt.
