# verify-eventpulse-discovery/features — index

Feature-map för discovery-pipelinen. Speglar steg-listan i `scripts/ingestion-cron.ts:265–467` + `09-ScrapingSupervisor/runDaily.ts` + `07-Discovery/src/`.

| Steg | Stage-typ | Feature-fil | Status |
|---|---|---|---|
| `tribe-events` | `.mjs` adapter | `tribe-events.md` | live |
| `sitemap-discovery` | `.mjs` discovery | `sitemap-discovery.md` | live |
| `subpath-discovery` | `.mjs` discovery | `subpath-discovery.md` | live |
| `P3A-discovery`, `P3B-geo`, `P3C-rss` | venue-graph / RSS / Exa+CSE | `p3-discovery-stages.md` | live |
| orchestrator | `scripts/ingestion-cron.ts` | `orchestrator-cron.md` | live |
| `eventbrite-pagination` | `.mjs` adapter | `eventbrite-pagination.md` | live |
| `direct-jsonld` | `.mjs` adapter | `direct-jsonld.md` | live |
| `livespot-stockholm` | `.mjs` adapter | `livespot.md` | live |
| `etag-refresh` | dedup-cache | `etag-refresh.md` | live |
| `api-discovery` | hidden API discovery | `api-discovery.md` | live |
| `luma`, `ra`, `posh`, `reddit` | community-plattformar | `community-platforms.md` | live |
| `P3D-source-candidate-tests` | discovery claim/promote loop | `p3d-source-candidate-tests.md` | live (ny 2026-10-21) |
| `runC-pattern-promoter` (ur cron, kod kvar) | html-gate pattern | `pattern-promoter.md` | dormant |
| orchestrator | `09-ScrapingSupervisor/runDaily.ts` | `orchestrator-rundaily.md` | live |
| `A-directAPI`, `B-network-api` | feed ingestion | – | cross-ref `verify-eventpulse-agent/features/ingestion-dashboard.md` |
| `C-htmlGate`, `D-renderGate`, `I-pdfExtraction` | html-gate / render | – | cross-ref `02-Ingestion/C-htmlGate/123.md` |

Cross-cutting (ej egna feature-filer):
- Dashboard `runtime/ingestion-cron.status.json`-läsning på port 7777 — verifieras i `verify-eventpulse-agent/features/ingestion-dashboard.md`.
- BullMQ-worker som dränerar kön — verifieras i `verify-eventpulse-agent/features/agent-feed.md`.

Varje feature-fil har fyra H2:er: `Sub-features`, `How to get to it (user POV)`, `Driving it`, `Gotchas`. Drift i någon av dessa är `verify-eventpulse-discovery`-skillens ansvar. Produktkod-drift rapporteras separat och hålls utanför denna PR.

**Source-täckning (2026-10-18):**
- 15 `scripts/ingest-*.mjs` / `scripts/discover-*.mjs`
- 22 `07-Discovery/src/**/*.ts`
- 1 orchestrator i `scripts/`, 1 i `09-ScrapingSupervisor/`
- 4 P3-steg (discoverySearch, expansionRunner, rssDiscovery, geoExpansion) + P3D claim/promote loop
- 1 C-htmlGate-steg i förklädnad (runC-pattern-promoter) — dormant efter 2026-10-21

**Verifieringsprovenok:** drives som löper mot chain-overview.log + status.json + jsonl + per-step log-filer. Inga egna sub-process-spawns.

**Alla `ls -t steps/<step>-*.log | head -1` måste filtrera bort `.err.log`.** Filerna skrivs parvis och fel-loggen är nästan alltid nyast (den touchas sist). Utan `grep -v '\.err\.log$'` läser varje recipe fel-loggen, som bara innehåller `─── started/finished`-ramen — altså noll resultatdata.

**Tre steg skriver till samma tabell.** P3A, P3B och P3C skriver alla till `source_candidates` med olika `engine`-värde. `geo_candidates` och `rss_feeds` finns inte i databasen trots att stegnamnen antyder det.

**Steg som är observerande utan konsument:** `subpath-discovery` (output: `subpath-results.jsonl`, ingen läsare), `api-discovery` (`api-discovery-results.jsonl`, konsumeras av tribe-fetcher, men i praktiken noll-events), `pattern-promoter` (ur cron 2026-10-21; kod kvar på disk). De kan verifieras som "kördes" men aldrig som "gjorde nytta".

**P3D-source-candidate-tests stänger loopen.** De tre discovery-stegen P3A/P3B/P3C skriver 335 kandidater till `source_candidates`; P3D claimar dem via `claim_source_candidate_test_queue(task_limit, target_phase)`, kör varje i en riktig sandbox-miljö genom A/B/C/D-gates, och promote:ar de som passerar smoke-trösklarna (skriver `sources/<slug>.jsonl` som A-gates ser).

**Senast uppdaterad (2026-10-21, maintain-pass):** 13 feature-filer samt SKILL.md och båda harness-scripten reviderade. Rättade: 13 trasiga logglobs, 4 fel watchdog-sökvägar, 2 falska tabellnamn, fel fältnamn i watchdog-checken, 4 recept som greppade strängar scripterna inte skriver, samt 4 missvisande påståenden om konsumtion och persistens. Verifierat live mot 2026-10-21-körningen (24/24 steg, pid 22127).