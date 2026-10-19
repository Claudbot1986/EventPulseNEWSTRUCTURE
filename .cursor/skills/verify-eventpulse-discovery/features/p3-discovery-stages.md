# p3-discovery-stages

P3A-P3C discovery stages. Venue-graph expansion + RSS-prenumerationer + Google CSE/Exa-sökning.

## Sub-features

- `P3A-discovery`: `07-Discovery/src/searchEngines/discoverySearch.ts` — Exa primär, Google CSE fallback. Output: `source_candidates`.
- `P3B-venue-graph-geo`: `07-Discovery/src/venueGraph/geoExpansion.ts` (via `expansionRunner.ts`) — venue-graph breddning. Output: `source_candidates` med `engine='venue_graph_geo'` (skriver INTE till en separat `geo_candidates`-tabell).
- `P3C-rss-discovery`: `07-Discovery/src/searchEngines/rssDiscovery.ts` — RSS-prenumerationer. Output: `rss_feeds` (eller `--dry-run=true` → ingen DB-write).

## How to get to it (user POV)

Användaren ser P3A-P3C som "nya källor dyker upp i grafén". P3A = nya URL:ar från Google-sökning. P3B = nya venues i närliggande kommuner (Solna, Sundbyberg, Nacka). P3C = RSS-prenumerationer som matar events automatiskt.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. P3A-P3C: alla tre har step-end med exit=0?
jq -r 'select(.event=="step-end" and (.step|startswith("P3A-") or startswith("P3B-") or startswith("P3C-"))) | "\(.step)\texit=\(.exitCode)\tduration=\(.durationMs)ms"' \
  runtime/ingestion-cron/chain-overview.log | tail -10

# 2. P3A: Exa/CSE-resultat i log
LATEST=$(ls -t runtime/ingestion-cron/steps/P3A-discovery-*.log 2>/dev/null | head -1)
grep -E "(exa|cse|url|candidate)" "$LATEST" 2>/dev/null | tail -5

# 3. P3B-venue-graph-geo: senaste log
LATEST=$(ls -t runtime/ingestion-cron/steps/P3B-venue-graph-geo-*.log 2>/dev/null | head -1)
grep -E "(candidate|venue|expanded)" "$LATEST" 2>/dev/null | tail -10

# 4. P3C-rss-discovery: senaste log
LATEST_RSS=$(ls -t runtime/ingestion-cron/steps/P3C-rss-discovery-*.log 2>/dev/null | head -1)
grep -E "(feed|rss|found)" "$LATEST_RSS" 2>/dev/null | tail -10

# 5. Supabase counts (om supabase-cli finns)
echo "SELECT 'source_candidates' AS t, COUNT(*) FROM source_candidates WHERE created_at > now() - interval '24 hours'
UNION ALL
SELECT 'rss_feeds', COUNT(*) FROM rss_feeds WHERE created_at > now() - interval '24 hours';"
```

Bevis: `chain-overview.log` (step-end events) + `source_candidates`, `rss_feeds` counts.

## Gotchas

**P3A är no-op utan `GOOGLE_CSE_ID` + `GOOGLE_API_KEY`.** Sätt båda i `.env` eller använd Exa via `EXA_API_KEY`. Om båda saknas → 0 URLs i output → stage slutförs på ~5s med exit=0 (inte ett fel).

**P3A Exa först** — `07-Discovery/src/searchEngines/discoverySearch.ts` testar Exa först, faller tillbaka till Google CSE om Exa returnerar < minExa URLs. `--min-exa=1` (default 1) är ganska aggressivt — kan ge mestadels Google CSE-resultat.

**P3B-venue-graph-geo: `--limit 5` i smoke** annars `--limit 50`. Antal venues expanderade varierar kraftigt mellan körningar beroende på venue graph-tillstånd.

**P3B skriver till `source_candidates`, inte `geo_candidates`.** Trots steg-namnet "venue-graph-geo" persisteras inte i en dedikerad geo-tabell — verifiera mot `source_candidates WHERE engine='venue_graph_geo'`.

**P3C-rss `--dry-run=true` i smoke** (`--smoke`-flagga sätter detta) — scriptet skriver INTE till DB. Verifiera `--dry-run=false` för produktionskörningar (default i cron).

**`07-Discovery/src/sourceTesting/` har LLM-driven discovery-ranking** (`realToolRunner`, `runner`, `phases`, `decision`). Dessa är separata från P3A-P3C och använder Exa + MiniMax M3 för att välja bland kandidat-sajter. Verifieras separat om du implementerar source-candidate-testing som feature.