# p3-discovery-stages

P3A-P3C discovery stages. Venue-graph expansion + RSS-prenumerationer + Google CSE/Exa-sökning.

## Sub-features

- `P3A-discovery`: `07-Discovery/src/searchEngines/discoverySearch.ts` — Exa primär, Google CSE fallback. Output: `source_candidates`.
- `P3B-venue-graph-geo`: `07-Discovery/src/venueGraph/geoExpansion.ts` — venue-graph breddning (anropas direkt, INTE via `expansionRunner.ts`). Output: `source_candidates` med `engine='venue_graph_geo'` (skriver INTE till en separat `geo_candidates`-tabell — den tabellen finns inte).
- `P3C-rss-discovery`: `07-Discovery/src/searchEngines/rssDiscovery.ts` — RSS-prenumerationer. Output: `source_candidates` med `engine='rss_discovery'` (skriver INTE till `rss_feeds` — den tabellen finns inte). Med `--dry-run` (presence-flagga) → ingen DB-write.

## How to get to it (user POV)

Användaren ser P3A-P3C som "nya källor dyker upp i grafén". P3A = nya URL:ar från Google-sökning. P3B = nya venues i närliggande kommuner (Solna, Sundbyberg, Nacka). P3C = RSS-prenumerationer som matar events automatiskt.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. P3A-P3C: alla tre har step-end med exit=0?
jq -r 'select(.event=="step-end" and (.step|startswith("P3A-") or startswith("P3B-") or startswith("P3C-"))) | "\(.step)\texit=\(.exitCode)\tduration=\(.durationMs)ms"' \
  runtime/ingestion-cron/chain-overview.log | tail -10

# 2. P3A: Exa/CSE-resultat i log
LATEST=$(ls -t runtime/ingestion-cron/steps/P3A-discovery-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1)
grep -E "(exa|cse|url|candidate)" "$LATEST" 2>/dev/null | tail -5

# 3. P3B-venue-graph-geo: senaste log
LATEST=$(ls -t runtime/ingestion-cron/steps/P3B-venue-graph-geo-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1)
grep -E "(candidate|venue|expanded)" "$LATEST" 2>/dev/null | tail -10

# 4. P3C-rss-discovery: senaste log
LATEST_RSS=$(ls -t runtime/ingestion-cron/steps/P3C-rss-discovery-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1)
grep -E "(feed|rss|found)" "$LATEST_RSS" 2>/dev/null | tail -10

# 5. Supabase counts — alla tre steg skriver till source_candidates
echo "SELECT engine, COUNT(*) FROM source_candidates
 WHERE created_at > now() - interval '24 hours'
   AND engine IN ('exa_search','google_cse','venue_graph_geo','rss_discovery')
 GROUP BY engine;"
```

Bevis: `chain-overview.log` (step-end events) + `source_candidates` uppdelat på `engine`.

## Gotchas

**P3A kräver `EXA_API_KEY` — Google-nycklarna är bara reserv.** `discoverySearch.ts:240` gate:ar Exa på `EXA_API_KEY`, Google-grejen på `GOOGLE_API_KEY` + `GOOGLE_CSE_ID`. `isPlaceholderKey()` (rad 121) avvisar `_FAKE_|_PLACEHOLDER_|REPLACE_ME|TODO|FIXME` — dina `.env`-värden för Google matchar `_PLACEHOLDER_`, så reserven hoppas över korrekt. Båda motorerna nollställda → `fatal` (rad 375) → `exit=1`.

**P3A-körningen kan `exit=1` ge medan felet ligger i cron, inte i discoverySearch.** 2026-10-21 gav P3A `exit=1` med `exaAvailable: false` trots att nyckeln finns i `.env` — orsaken var att launchd-plisten saknade `set -a`, så `. ./.env` lade nycklarna i shellen men inte i child-processens miljö. **Verifiera alltid att `EXA_API_KEY` är nåbar av barnprocessen**, inte bara att den ligger i `.env`.

**P3A Exa först** — `discoverySearch.ts:269` skippar Google helt om `exaUrls.size >= minExa` OCH färre än halva queryerna felade. `--min-exa=1` (default) är aggressivt lågt.

**P3B-venue-graph-geo: `--limit 5` i smoke** annars `--limit 50`. Antal venues expanderade varierar kraftigt mellan körningar beroende på venue graph-tillstånd.

**P3B och P3C skriver BÅDA till `source_candidates`, inte till `geo_candidates`/`rss_feeds`.** Verifiera mot `source_candidates WHERE engine IN ('venue_graph_geo','rss_discovery')`. Step-namnen antyder egna tabeller — det finns de inte.

**`--dry-run` är en presence-flagga (`cliArgs.includes('--dry-run')`) i alla tre.** Att skriva `--dry-run=false` aktiverar ändå dry-run. Produktionskörningen har helt enkelt inget flagga.

**`07-Discovery/src/sourceTesting/` är INTE LLM-driven.** `realToolRunner.ts:31` spawnar `python3 Alltools-E2E/e2e.py --from-preA --limit 1 --apply` i en sandbox och räknar rader i sex jsonl-filer. `decision.ts:8` är ren regellogik (trösklar 45/90/65/80) — bara fasen `smoke` kan ge `promote`, allt annat blir `manual_review`/`reject`. Ingen Exa, ingen MiniMax, ingen LLM. Verifieras separat om du implementerar source-candidate-testing som feature.