# Stadens väg genom kedjan

## Sub-features

- **`city` är fältet som avgör om något når Stockholm.** Det existerade
  ingenstans i kedjan före 2026-10-23. Nu: kolumn i `source_candidates` och
  `source_candidate_test_queue` (migration `20261021-0003`), satt av varje
  producent, förd av `sync_source_candidate_queue_city()`, buren genom CLI
  (`city: item.city ?? null`) och skriven till filen av `sourceRecord()`.
- **P3A `discoverySearch.ts`** — `DISCOVERY_QUERY_CITY` (13 frågor →
  stad) + `cityForDiscoveryQuery()`. Exa-vägen bygger `exaCityByUrl` per URL.
  Efter upsert patchas `city` på rader som fortfarande saknar den (`.is('city',
  null)`, inte `.eq('city', null)` — det senare matchar strängen `"null"`).
- **P3B `geoExpansion.ts`** — `CITY_BOUNDS` lat/lng-box per stad; venues
  filtreras på koordinater, **inte** på `venues.city` (den kolumnen är
  korrupt: Örebro Konserthus, Malmö Arena, Ullevi m.fl. står som
  "Stockholm"). Okänd stad → `firstError` med uppmaningen att lägga till den
  i `CITY_BOUNDS`.
- **P3C `rssDiscovery.ts`** — `SourceEntry.city` + `DiscoveredFeed.city`.
- **Backfill** — `backfillCandidateCities.ts` härleder per engine
  (`venue_graph_geo` → centroid mot `CITY_BOUNDS`; `exa_search`/`google_cse`
  → `cityForDiscoveryQuery(source_query)`; `rss_discovery` → `sources/<id>.jsonl`).
  Skyddsregel: en känd stad får aldrig skrivas över med "vet inte".

## How to get to it (user POV)

Du ser att discovery hittat Göteborgs arenor och Malmöfestivaler och undrar
varför de inte hamnat i Stockholms pool. Eller tvärtom: du ser att en
Stockholmsvenue inte körs. Svaret ligger i `city` — på DB-raden, i kön och i
filen.

## Driving it

```bash
cd /Users/claudgashi/EventPulse
DBQ=".cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs"

# Fördelning per motor × stad
node "$DBQ" "SELECT engine, coalesce(city, '(saknas)') AS city, count(*)::int AS n
               FROM source_candidates GROUP BY 1,2 ORDER BY 1, 3 DESC"

# Bär kön staden?
node "$DBQ" "SELECT coalesce(city,'(saknas)') AS city, count(*)::int AS n
               FROM source_candidate_test_queue GROUP BY 1 ORDER BY 2 DESC"

# Promoteade filer per stad
node "$DBQ" "SELECT d.promoted_source_id, sc.city
               FROM source_candidate_test_decisions d
               JOIN source_candidates sc ON sc.id = d.source_candidate_id
              WHERE d.decision='promote' ORDER BY d.created_at DESC"

# Har P3B filtrerat på koordinater (inte venues.city)?
grep -n "CITY_BOUNDS\|gte('lat'\|lte('lat'\|gte('lng'\|lte('lng'" \
  07-Discovery/src/venueGraph/geoExpansion.ts | head
#    → CITY_BOUNDS + lat/lng-filter. Saknas .eq('city', …) på venue-frågan.
```

## Gotchas

**260 köposter har `city = NULL`, av två olika ärliga skäl.** Exa-vägen slår
ihop hela frågelistan till en URL-mängd, så `source_query` blir
`"events Stockholm 2026 | konsert Stockholm 2026 | …"`. I efterhand går det
inte att härleda vilken av 13 frågor som träffade — det är de 213
`exa_search`-raderna. De 41 `venue_graph_geo`-raderna saknar stad för att
deras centroid **inte** ligger i Stockholms bbox, vilket är korrekt — de är
utanför Stockholm. `backfillCandidateCities.ts` lämnar båda; de
promote:as utan stad och hamnar utanför Stockholms pool. Säkert, men de
matar inte appen.

**`venues.city` är korrupt och får INTE användas som filter.** Örebro
Konserthus, Malmö Arena, Växjö Konserthus, Ullevi, Kinna, Horred står alla som
`"Stockholm"`. Det var rotorsaken till 41 out-of-Stockholm-kluster från P3B.
Filtrera på `lat`/`lng` mot `CITY_BOUNDS`.

**`.eq('city', null)` matchar strängen `"null"`, inte NULL.** supabase-js
skickar `city=eq.null`. Måste vara `.is('city', null)`. Symmetriskt: `.eq`
för icke-null-värden fungerar som väntat.

**`backfillCandidateCities.ts` skrev en gång 31 korrekta stader till `NULL`.**
Den härdede staden ur `source_query` (merde frågelista → ingen stad) och
skrev över. Skyddsregeln som lagades till:
```ts
// En kän stad får aldrig skrivas över med "vet inte".
if (row.city !== null && derived === null) continue;
```
Om du ändrar den filen: behåll den raden.

**Backfillen måste avslutas med `sync_source_candidate_queue_city()`.** Annars
uppdaterar den bara `source_candidates` och kön ligger kvar med `city NULL`.
Dessutom: kör den INTE före migrationen — då skriver den mot en kolumn som
inte finns.

**Tre stader är operatörsatta, inte härledda.** `konserthuset.se` ×2 och
`nalen.com` har `city='Stockholm'` för att en människa satte den. Båda är
Stockholmsinstitutioner och P3D:s smoke körning bevisade oberoende att de
serverar events. Skilj på det i rapporter — härledd ≠ satt.

**En stad i kandidattabellen betyder inte Stockholm.** Göteborg, Malmö och
Uppsala är korrekta värden (frågorna söker på dem). Endast
`city = 'Stockholm'` når A-gatet.