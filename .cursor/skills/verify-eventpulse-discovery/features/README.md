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
| `manual-review-triage` (pattern-promoter) | html-gate pattern | `pattern-promoter.md` | live |
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
- 4 P3-steg (discoverySearch, expansionRunner, rssDiscovery, geoExpansion)
- 1 C-htmlGate-steg i förklädnad (runC-pattern-promoter)

**Verifieringsprovenok:** drives som löper mot chain-overview.log + status.json + jsonl + per-step log-filer. Inga egna sub-process-spawns.

**Senast uppdaterad (2026-10-19):** 13 feature-filer genererade (8 planerade → live + 5 befintliga). Nästa maintain-pass körs `/maintain-verification-skill` mot EventPulse.