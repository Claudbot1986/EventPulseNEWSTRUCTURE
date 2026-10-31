# Discovery-handoff — hittar discovery nya källor, och kommer de till ingestion?

## Sub-features

- **P3A** (`07-Discovery/src/searchEngines/discoverySearch.ts:279`) — Exa-sök
  (Google-CSE som fallback) → upsert i `source_candidates`.
- **P3B** (`venueGraph/geoExpansion.ts:311`) — venue-graph-geografi → samma tabell.
- **P3C** (`searchEngines/rssDiscovery.ts:476`) — RSS-läsning → samma tabell
  (i smoke-läge körs den med `--dry-run` och skriver ingenting).
- **P3D** (`sourceTesting/runSourceCandidateTests.ts`) — claimar ur testkön och
  testar med den **riktiga** A/B/C/D-gaten. Kommandot ligger i
  `realToolRunner.ts:61-68`: `python3 Alltools-E2E/e2e.py --from-preA --limit 1 --apply`.
- **Promote** (`sourceTesting/sandbox.ts:109`) — skriver `sources/<slug>.jsonl`
  (`:176`) och `runtime/discovery-ui-queue.jsonl` (`:177`).
- **09-DiscoveryAgent** — separat agent (heal/promote/expand) mot
  `runtime/discovery-candidates.jsonl`; promote skriver också
  `sources/<slug>.jsonl`, expand körs bara på måndagar.

## How to get to it (user POV)

Operatören ser promote-listan i `runtime/discovery-ui-queue.jsonl` och de nya
källfilerna i `sources/`. Från dem förväntar sig agenten att nya evenemang
kommer in i appen.

## Driving it with <harness>

```bash
cd /Users/claudgashi/EventPulse
node scripts/verify-discovery-handoff.mjs --state-only   # bara D1, ingen körning
node scripts/verify-discovery-handoff.mjs --limit 5       # 5 kandidater, riktig gate
```

| Gate | Krav | Negativ kontroll |
|---|---|---|
| D1a | pending Stockholm-kandidater finns i `source_candidates` | — |
| D1b | ingen pending-kandidat saknas i testkön | ✅ kandidat utanför kön = trasig länk |
| D1c | kön har claimbara rader (`pending` + `city='Stockholm'`) | ✅ 0 claimbara = samma fel som 2026-10-31 |
| D2a | P3D claimade minst en kandidat | ✅ 0 claimade = samma fel som 2026-10-31 |
| D2b | testerna körde `e2e.py` | ✅ rad utan `e2e.py` = simulering, förbjuden |
| D3 | beslut sparades i `source_candidate_test_decisions` | — |
| D4a | promote skrev `sources/<slug>.jsonl` | — |
| D4b | filen bär `city=Stockholm` | ✅ saknad city → A-gatens `isInScope` kastar bort källan |
| D4c | kandidaten är `verified` i kandidattabellen | — |
| D4d | promote finns i `runtime/discovery-ui-queue.jsonl` | — |

**PASS** = alla gater `OK` + `✓ alla gater passerade` + exit 0 + rapport i
`runtime/verification-reports/discovery-handoff-<TS>.json`.
**FAIL** = `✗ röda gater: <ids>`.

D2b och D3 är bundna till **den körning** gaten gjorde (tidsgräns på
`created_at`) — annars kunde en äldre natt uppfylla dem.

## Gotchas

- **"Inga events" är inte samma som "trasig".** De flesta Exa-träffar är
  väggar eller redan kända källor; `decision: reject` är ett legitimt utfall.
  Gaten blir röd först när *mekaniken* är trasig (0 claimade, inga beslut, ingen
  fil).
- **Claim-funktionen filtrerar på `city='Stockholm'`**
  (`05-Supabase/migrations/20261023-0001-claim-stockholm-candidates-only.sql:79`).
  En kö-rad med `city=NULL` är oclaimbar. `sync_source_candidate_queue_city()`
  fyller city från kandidaten — kandidater utan city förblir oclaimbara, och
  det är normalt (de är inte Stockholm-kandidater).
- **Tiden per kandidat är bimodal.** Snabba avslag tar ~3 s (inga nätanrop
  behövs); kandidater som går igenom render-gaten tar 100–240 s. Ett 20-batch
  tog 10,3 min (2026-10-28) medan dagens körning legat på ~2 min/kandidat
  eftersom flera tog render-vägen. "2,5 min × N" är alltså en övre gräns, inte
  en prognos.
- **Filnamnsmönstret är domän-slug** (`sandbox.ts:132-133`) — t.ex.
  `wwwfamgose.jsonl` — inte `candidate-<hash>-<slug>.jsonl` (det mönstret
  användes före 2026-10-24). En URL på en befintlig domän läggs som
  `metadata.eventUrls` i stället för en egen fil. Läs därför
  `promoted_source_id` ur beslutsraden — gissa inte filnamnet.
- **P3D kör före A-gaten i kedjan** (P3-stegen är splice:ade först,
  `scripts/ingestion-cron.ts:1047-1059`), så en promote:ad källa kan nå
  A-gaten samma natt.
- **Gaten konkurrerar om samma testkö som en pågående P3D.** Kör den inte
  parallellt med en nattlig kedja.
- **`--no-promote` gör D4a mjuk** — men hoppar då över D4b–D4d helt.
