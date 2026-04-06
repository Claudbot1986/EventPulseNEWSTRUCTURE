# 00A — ImportRawSources Tool

## Syfte

Verktyget importerar råa source-listor till deduplicerade canonical sources.
Detta är **endast ett importverktyg** — det skriver inte direkt till `sources/`.

## Inputformat

Verktyget läser en rå textfil med formatet:

```
| Namn | URL | Stad | Kategori | Insamlad | Notis |
| ABF | https://www.abf.se | Stockholm | förening | 2026-04-04 | Studieförbund |
```

## Två typer av deduplicering

### 1. Intern import-dedup (inom samma importfil)

Två rader med samma canonical URL inom samma importbatch slås ihop till en source.
Se `duplicate_in_import` i matchStatus.

### 2. Matchning mot befintliga canonical sources

Verktyget läser alla befintliga `sources/*.jsonl` och matchar importerade rader mot dessa.
Detta avgör om en rad är:
- **ny** — ingen match i befintliga sources
- **matched_existing** — samma URL finns redan i `sources/`
- **duplicate_in_import** — samma URL inom importfilen

## Deduplikationsregler (URL-normalisering)

Canonicalisering av URL:
1. Strippa protokoll (`http://` och `https://`)
2. Strippa `www.`-prefix
3. Strippa avslutande `/`
4. Lägg till `/` om ingen path finns
5. Konvertera till lowercase

Exempel: `https://www.ARKitekturgalleriet.se/` → `arkitekturgalleriet.se`

## sourceId-regler

**Matched existing sources:** Behåller befintligt `id` från `sources/*.jsonl`.

**Nya sources:** Genereras från hostname:
1. Extrahera hostname
2. Strippa `.se`, `.no`, `.dk`, `.fi`, `.nu`
3. Ersätt svenska tecken (å→a, ä→a, ö→o)
4. Ersätt `_` och `-` med `-`
5. Strippa ledande/avslutande `-`
6. Max 40 tecken

## Output: import-preview

Verktyget skapar `import-preview.jsonl` med:

```json
{
  "sourceId": "unga-teatern",
  "canonicalUrl": "ungateatern.se/",
  "name": "Unga Teatern",
  "city": "Stockholm",
  "type": "teater",
  "discoveredAt": "2026-04-06",
  "note": "Test",
  "dedupeKey": "ungateatern.se/",
  "isDuplicate": false,
  "originalRows": [
    { "name": "Unga Teatern", "url": "https://www.ungateatern.se" }
  ],
  "matchStatus": "matched_existing",
  "matchedBy": "canonicalUrl",
  "existingSource": {
    "id": "unga-teatern",
    "name": "Unga Teatern",
    "preferredPath": "unknown"
  }
}
```

### matchStatus-värden

| Värde | Betydelse |
|-------|-----------|
| `new` | Ingen match i befintliga `sources/`, ingen dup inom import |
| `matched_existing` | Samma canonical URL finns i `sources/` |
| `duplicate_in_import` | Samma canonical URL inom importfilen (merged med primär) |

## matchStatus hierarki

**Matchning mot existing har PRIORITET över intern dedup.**

Logik:
1. Om `dedupeKey` matchar befintlig source → `matched_existing` (behåller existing id)
2. Om `dedupeKey` redan setts i importen → `duplicate_in_import`
3. Annars → `new`

## Viktigt: Olika URL:er med samma hostname = OLIKA sources

`liseberg.se/` och `liseberg.se/evenemang/` är **olika** sources i verktygets ögon.
Detta är korrekt beteende — subpage-event är en potentiellt separat källa.

## Vad verktyget gör

- [x] Läser råa markdown-tabell-filer
- [x] Normaliserar URLs
- [x] Genererar stabila sourceIds för nya sources
- [x] Deduplicerar inom importfilen
- [x] Matchar mot befintliga `sources/*.jsonl`
- [x] Sätter matchStatus korrekt
- [x] Presenterar alla original-rader i `originalRows`

## Vad verktyget ÄNNU INTE gör

- [ ] Skriver inte till `sources/`
- [ ] Gör inte merge med `runtime/sources_reset_state.jsonl`
- [ ] Sätter inte `preferredPath` för nya sources
- [ ] Sätter inte `discoveredBy` för nya sources
- [ ] Hanterar inte case-insensitiv name-dedup (endast URL)
- [ ] Ingen merge av sources med samma hostname men olika paths
- [ ] Ingen batch-import med flera filer
- [ ] Ingen idempotenskontroll mot befintliga canonical sources (samma import kan köras flera gånger och producera samma output — men om befintliga sources redan har data kan det leda till duplicates i `sources/`)

## Användning

```bash
npx tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts \
  --input 01-Sources/RawSources/RawSources20260404.md \
  --output runtime/import-preview.jsonl \
  --sources-dir sources/
```

## Idempotenskrav

- Kör samma importfil två gånger → samma `import-preview.jsonl` (samma matchStatus)
- Verktyget påverkar **inte** befintliga `sources/*.jsonl`
- Nästa steg: manuell granskning av preview, sedan eventuell merge
