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

Användaren ser P3A-P3C som "nya källor dyker upp i grafén". P3A = nya URL:ar från sökning. P3B = kluster av Stockholmsvenues som ligger nära varandra — bara inom Stockholms box, inte i grannkommunerna. P3C = RSS-prenumerationer som matar events automatiskt.

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
#
#    Undantag: venue_graph_geo KAN ha city = NULL och det är då korrekt.
#    Ett kluster vars centroid ligger utanför Stockholms bbox har ingen
#    stad — det ska inte heller få en. Läs därför alltid BOTH-siffrorna
#    tillsammans: n=0 är problem, withCity<n är inte alltid problem.

# 6. Fyll luckor retroaktivt (kräver att 5b visat gapet först)
npx tsx 07-Discovery/src/sourceTesting/backfillCandidateCities.ts --dry-run
npx tsx 07-Discovery/src/sourceTesting/backfillCandidateCities.ts
```

Bevis: `chain-overview.log` (step-end events) + `source_candidates` uppdelat på
`engine` **och** på `city`. Grön `exit=0` utan `city` är inte bevis på att
något blev användbart.

## Gotchas

**P3A kräver `EXA_API_KEY` — Google-nycklarna är bara reserv.** `discoverySearch.ts:295` gate:ar Exa på `EXA_API_KEY`, Google-grejen på `GOOGLE_API_KEY` + `GOOGLE_CSE_ID`. `isPlaceholderKey()` (rad 148) avvisar `_FAKE_|_PLACEHOLDER_|REPLACE_ME|TODO|FIXME` — dina `.env`-värden för Google matchar `_PLACEHOLDER_`, så reserven hoppas över korrekt. Båda motorerna nollställda → `fatal` (rad 435) → `exit=1`.

**P3A-körningen kan `exit=1` ge medan felet ligger i cron, inte i discoverySearch.** 2026-10-21 gav P3A `exit=1` med `exaAvailable: false` trots att nyckeln finns i `.env` — orsaken var att launchd-plisten saknade `set -a`, så `. ./.env` lade nycklarna i shellen men inte i child-processens miljö. **Verifiera alltid att `EXA_API_KEY` är nåbar av barnprocessen**, inte bara att den ligger i `.env`.

**P3A Exa först** — `discoverySearch.ts:329-330` skippar Google helt om `exaUrls.size >= minExa` OCH färre än halva queryerna felade. `--min-exa=1` (default) är aggressivt lågt.

**Båda motorerna delar EN frågelista.** `googleCustomSearch.ts:35` importerar
`DISCOVERY_QUERIES` och `cityForDiscoveryQuery` från `discoverySearch.js` — det
finns ingen lokal kopia i Google-filen. Kontrollera därför `discoverySearch.ts`
när du vill veta vad P3A söker; du får inte samma svar genom att läsa
Google-filen.

**Frågelistan är 13 frågor, och `DISCOVERY_QUERY_CITY` har exakt samma 13.**
Rad 92–106 respektive 114–128, i samma ordning. Verifiera med:
```bash
node -e '
const s = require("fs").readFileSync("07-Discovery/src/searchEngines/discoverySearch.ts", "utf8");
// Listan: värden. Objektet: NYCKLAR — måste matcha "x":, inte bara "x",
// annars fångas även stadsvärdena och du får 13 mot 26 i stället för 13 mot 13.
const list = (re) => [...s.match(re)[1].matchAll(/'"'"'([^'"'"']+)'"'"'/g)].map(m => m[1]);
const keys = (re) => [...s.match(re)[1].matchAll(/'"'"'([^'"'"']+)'"'"':/g)].map(m => m[1]);
const q = list(/DISCOVERY_QUERIES[^=]*=\s*\[([\s\S]*?)\];/);
const c = keys(/DISCOVERY_QUERY_CITY[^=]*=\s*\{([\s\S]*?)\};/);
console.log(q.length, c.length,
  "saknar stad:", q.filter(x => !c.includes(x)),
  "stad utan fråga:", c.filter(x => !q.includes(x)));
'
#    → 13 13 saknar stad: [] stad utan fråga: []
```
Tio av dem söker Stockholm, tre söker Göteborg/Malmö/Uppsala. Att listan
innehåller icke-Stockholms-frågor är avsiktligt — kandidaten bär staden den
faktiskt söktes i.

**P3B-venue-graph-geo är Stockholms-box, inte "närliggande kommuner".**
`CITY_BOUNDS` (rad 76-80) definierar bara `Stockholm`, och filtren är ett
hårt lat/lng-fält (rad 226-229). `--city` med någon annan stad ger
`firstError: unknown city "…"` (rad 213-217) och avslutar med `exit=1`
(rad 337). Utöka då `CITY_BOUNDS` först. Verifierat 2026-10-23:
`--city Kiruna --limit 1 --dry-run` → `exit=1`, `topClusters: []`;
`--city Stockholm --limit 1 --dry-run` → `exit=0`, ett kluster.

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

**P3C skriver `city: f.city ?? null` — RSS-radens stad kommer från
feed-källan, inte från någon fråga.** En `rss_discovery`-kandidat får stad bara
om `DiscoveredFeed.city` satt var. Mätt 2026-10-23: senaste dygnet gav 1
kandidat med `withCity: 0` — korrekt, den feeden bar ingen stad.

Men RSS-kandidater har en väg att få stad i efterhand:
`backfillCandidateCities.ts` härleder `rss_discovery` ur **filen på disk**
(`source_query` har formen `rss:<sourceId>`, sedan läses `sources/<id>.jsonl`
och dess `city`-fält — rad 76-80). Därför finns 36 Stockholmsrader bland
RSS-kandidater trots att de senaste feed-lästa inte har det. Kör backfillen
för att se hur många RSS-rader som faktiskt är användbara; just nu svarar den
`toUpdate: 0`, alltså redan allt härlett.

**`backfillCandidateCities.ts` ligger i `sourceTesting/` och SKRIVER till
`source_candidates`.** Den kör `.update({city})` (rad 135) och avslutar med
`sync_source_candidate_queue_city()` (rad 139). Så det är fel att tänka att
`sourceTesting/` bara är testkod. Men den skriver **inte** till `runtime/`-filerna
— en `sources/*.jsonl` som redan promote:ats utan stad förblir osynlig tills den
promote:as om. Backfillen kan inte reparera en redan skriven fil.

Den räcker inte heller för Exa-råden (ovan) och den ska **inte** ge stad till
de 41 `venue_graph_geo`-raderna utanför Stockholm — de har `NULL` av korrekta
skäl. Kör `--dry-run` först och läs `toUpdate` innan du skriver.

**En stad i kandidattabellen betyder inte Stockholm.** `DISCOVERY_QUERY_CITY`
innehåller Göteborg, Malmö och Uppsala — de är korrekta värden (frågorna söker
på dem). Endast `city = 'Stockholm'` når A-gatet. Mätt 2026-10-23: av 34
`exa_search`-rader på ett dygn hade 34 stad men bara **4** Stockholm. `withCity`
är alltså inte samma sak som "når ingestion".