# p3-discovery-stages

P3A-P3C discovery stages. Venue-graph expansion + RSS-prenumerationer + Google CSE/Exa-sökning.

## Sub-features

- `P3A-discovery`: `07-Discovery/src/searchEngines/discoverySearch.ts` — Exa primär, Google CSE fallback. Output: `source_candidates`.
- `P3B-venue-graph-geo`: `07-Discovery/src/venueGraph/geoExpansion.ts` — venue-graph breddning (anropas direkt, INTE via `expansionRunner.ts`). Output: `source_candidates` med `engine='venue_graph_geo'` (skriver INTE till en separat `geo_candidates`-tabell — den tabellen finns inte).
- `P3C-rss-discovery`: `07-Discovery/src/searchEngines/rssDiscovery.ts` — RSS-prenumerationer. Output: `source_candidates` med `engine='rss_discovery'` (skriver INTE till `rss_feeds` — den tabellen finns inte). Med `--dry-run` (presence-flagga) → ingen DB-write.
- **`city` skrivs av alla tre.** Utan den är kandidaten osynlig för ingestion
  (`isInScope()` kräver exakt `'Stockholm'`). P3A: `DISCOVERY_QUERY_CITY`
  (13 frågor → stad) + `cityForDiscoveryQuery()` (`discoverySearch.ts:114-132`),
  skriven på rad 225. P3B: `cityFilter` från `--city` (rad 322), skriven på rad
  287. P3C: `SourceEntry.city` → rad 465.

## How to get to it (user POV)

Användaren ser P3A-P3C som "nya källor dyker upp i grafén". P3A = nya URL:ar från Google-sökning. P3B = nya venues i närliggande kommuner (Solna, Sundbyberg, Nacka). P3C = RSS-prenumerationer som matar events automatiskt.

Det som avgör om en ny källa *räknas* är `city`. En kandidat utan stad promote:as
korrekt men når aldrig A-gatet. Läs `city` som den kolumnen i steg 5 nedan.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# Hämta bara de två nycklarna. Sourcing av hela .env FÖRSTÖR: rad 58 är en
# flerradig base64-token som skalet försöker köra som kommando.
export SUPABASE_URL=$(grep -E '^SUPABASE_URL=' .env | cut -d= -f2-)
export SUPABASE_SERVICE_ROLE_KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2-)
#    CLI:et laddar .env självt; curl-receptet gör inte det.

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

# 5. Supabase counts — alla tre steg skriver till source_candidates.
#    Ingen psql finns på maskinen; gå via REST med service_role-nyckeln.
sq() { curl -s "$SUPABASE_URL/rest/v1/$1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"; }

# 5a. Antal per motor, senaste dygnet
sq "source_candidates?select=engine&created_at=gte.$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)" \
  | jq 'group_by(.engine) | map({engine: .[0].engine, n: length})'

# 5b. Bär de city? Utan city når kandidaten aldrig A-gatet.
sq "source_candidates?select=engine,city&created_at=gte.$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)" \
  | jq 'group_by(.engine)
       | map({engine: .[0].engine, n: length,
              withCity: [.[] | select(.city != null)] | length,
              stockholm: [.[] | select(.city=="Stockholm")] | length})'
#    → withCity 0 för en motor = den sätter inte city = den kandidaten
#      promote:as men är osynlig för ingestion.
```

Bevis: `chain-overview.log` (step-end events) + `source_candidates` uppdelat på
`engine` **och** på `city`. Grön `exit=0` utan `city` är inte bevis på att
något blev användbart.

## Gotchas

**P3A kräver `EXA_API_KEY` — Google-nycklarna är bara reserv.** `discoverySearch.ts:240` gate:ar Exa på `EXA_API_KEY`, Google-grejen på `GOOGLE_API_KEY` + `GOOGLE_CSE_ID`. `isPlaceholderKey()` (rad 121) avvisar `_FAKE_|_PLACEHOLDER_|REPLACE_ME|TODO|FIXME` — dina `.env`-värden för Google matchar `_PLACEHOLDER_`, så reserven hoppas över korrekt. Båda motorerna nollställda → `fatal` (rad 375) → `exit=1`.

**P3A-körningen kan `exit=1` ge medan felet ligger i cron, inte i discoverySearch.** 2026-10-21 gav P3A `exit=1` med `exaAvailable: false` trots att nyckeln finns i `.env` — orsaken var att launchd-plisten saknade `set -a`, så `. ./.env` lade nycklarna i shellen men inte i child-processens miljö. **Verifiera alltid att `EXA_API_KEY` är nåbar av barnprocessen**, inte bara att den ligger i `.env`.

**P3A Exa först** — `discoverySearch.ts:269` skippar Google helt om `exaUrls.size >= minExa` OCH färre än halva queryerna felade. `--min-exa=1` (default) är aggressivt lågt.

**P3B-venue-graph-geo: `--limit 5` i smoke** annars `--limit 50`. Antal venues expanderade varierar kraftigt mellan körningar beroende på venue graph-tillstånd.

**P3B och P3C skriver BÅDA till `source_candidates`, inte till `geo_candidates`/`rss_feeds`.** Verifiera mot `source_candidates WHERE engine IN ('venue_graph_geo','rss_discovery')`. Step-namnen antyder egna tabeller — det finns de inte.

**`--dry-run` är en presence-flagga (`cliArgs.includes('--dry-run')`) i alla tre.** Att skriva `--dry-run=false` aktiverar ändå dry-run. Produktionskörningen har helt enkelt inget flagga.

**`07-Discovery/src/sourceTesting/` är INTE LLM-driven.** `realToolRunner.ts:31` spawnar `python3 Alltools-E2E/e2e.py --from-preA --limit 1 --apply` i en sandbox och räknar rader i sex jsonl-filer. `decision.ts:8` är ren regellogik — bara fasen `smoke` **med** `eventsPersisted > 0 && eventsAfterNormalization > 0` kan ge `promote`, allt annat blir `manual_review`/`reject`. Konstanterna 45/90/65/80 (`decision.ts:3-6`) är `confidenceScore`-värden som skrivs på beslutsraden; ingen jämförelse i `decision.ts` testar en kandidat mot dem. Ingen Exa, ingen MiniMax, ingen LLM. Se `p3d-source-candidate-tests.md` för hela beslutslogiken.

**`venues.city` är korrupt och får INTE användas som filter.** Örebro
Konserthus, Malmö Arena, Växjö Konserthus, Ullevi, Kinna och Horred står alla
som `city = 'Stockholm'` i `venues`-tabellen. `geoExpansion.ts` filtrerar därför
på `lat`/`lng` mot `CITY_BOUNDS` (rad 219-229), inte på `venues.city`. Om du
verifierar P3B genom att räkna venues med `city='Stockholm'` får du ett tal som
inte betyder något.

**`city` i `source_candidates` är inte samma sak som `city` i `venues`.**
Förra sätts av P3A/P3B/P3C och styr scope. Senare är trasig (ovan). Blanda
ihop dem ger felaktiga slutsatser om båda.

**Exa-vägens 213 `city = NULL`-rader är historiska, inte aktuella.** Rad 225
använder `cityByUrl?.get(url) ?? cityForDiscoveryQuery(sourceQuery)` — och
`cityByUrl` fylls per URL under Exa-loopen (rad 310), så varje URL bär med sig
frågans stad. Uppslaget fungerar. Mätt 2026-10-23: 129 `exa_search`-rader med
stad, senaste 2026-10-23T06:02Z; 213 utan, senaste **2026-10-22T01:21Z** — alla
före fixen. Ingen ny NULL-rad efteråt.

`source_query`-fältet är däremot värdelöst för retroaktiv härledning: det blir
den sammanslagna frågelistan (`"events Stockholm 2026 | konsert Stockholm 2026
| …"`), och `cityForDiscoveryQuery()` på den strängen ger `null` eftersom den
inte är en nyckel i `DISCOVERY_QUERY_CITY`. Därför kan
`backfillCandidateCities.ts` **inte** laga de 213 gamla raderna. Låt dem vara —
de promote:as utan stad och hamnar utanför Stockholms pool. Säkert, men de
matar inte appen.

**P3C skriver `city: f.city ?? null` — RSS-flöden bär oftast ingen stad.**
Mätt 2026-10-23: senaste 24 h gav 1 `rss_discovery`-kandidat med
`withCity: 0`. Det är korrekt beteende, inte en bugg — men det betyder att
RSS-kandidater nästan aldrig når A-gatet av sig själva. Om RSS-flöden ska
mata appen måste staden sättas i feed-källan, inte härledas.

**En stad i kandidattabellen betyder inte Stockholm.** `DISCOVERY_QUERY_CITY`
innehåller Göteborg, Malmö och Uppsala — de är korrekta värden (frågorna söker
på dem). Endast `city = 'Stockholm'` når A-gatet. Mätt 2026-10-23: av 34
`exa_search`-rader på ett dygn hade 34 stad men bara **4** Stockholm. `withCity`
är alltså inte samma sak som "når ingestion".