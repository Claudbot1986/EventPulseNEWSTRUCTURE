# Features — verify-eventpulse-ingestion-discovery

| Feature | Gate | Kommando | Fil |
|---|---|---|---|
| Världen lever + env parsebar | preflight / env | `node scripts/verify-preflight.mjs` | `features/alive.md` |
| Ingestion persisterar events | chain-live | `node scripts/verify-chain-live.mjs --limit 200` | `features/ingestion-live.md` |
| Discovery hittar + promote:ar | discovery-handoff | `node scripts/verify-discovery-handoff.mjs --limit 5` | `features/discovery-handoff.md` |
| Mini-ingestion över discovery-källor | mini-ingestion | `node scripts/verify-mini-ingestion.mjs` | `features/mini-ingestion.md` |

**Ordning:** alive → ingestion-live → discovery-handoff → mini-ingestion.
Steg 3 före 4 före 5 är fastställt av användaren 2026-10-31: ingestion bevisas
på egen hand, sedan discovery, sedan mini-ingestion över exakt de källorna
discovery hittade.

**Bevisfiler:** `runtime/verification-reports/<gate>-<timestamp>.json`

## Historik — vad gaterna faktiskt har fångat

| Datum | Gate | Fynd | Åtgärd |
|---|---|---|---|
| 2026-10-31 | chain-live | kedjan grön, men P3D testade 0 kandidater på 746 ms | `enqueue_source_candidate_tests()` + `sync_source_candidate_queue_city()` anropas nu före claim (`07-Discovery/src/sourceTesting/runSourceCandidateTests.ts`) |
| 2026-10-31 | discovery-handoff | kön fryst sedan 2026-10-23; 215 kö-rader med `city=NULL` (claim filtrerar på `city='Stockholm'`) | city-synk + enqueue i P3D; mätning: 99 nya rader i kön, 22 city-synkade |
| 2026-10-31 | mini-ingestion | A-gatens urval är preA → api-adapter → rss → never_run, så `--limit N` ensamt skulle klippt bort nya discovery-källor | källorna köas in i preA via befintlig CLI (`runA.ts --add`) |
| 2026-10-31 | (preflight) | purge-skydden frågade tabellen `user_interaction_save` som inte finns → sparade events raderades tyst | `scripts/lib/saved-events.ts`, fail-closed |
| 2026-10-31 | (kedjan) | MiniMax-429 slogs ut som fel → ~14 events utan LLM-beskrivning | 429/5xx-retry med backoff i `04-Normalizer/editorial/editorialWriter.ts` |
