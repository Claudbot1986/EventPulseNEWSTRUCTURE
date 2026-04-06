# 00A — ImportRawSources Tool

## Syfte

Verktyget importerar råa source-listor till deduplicerade canonical sources.
Detta är **endast ett importverktyg** — det skriver inte till `sources/` eller någon kö.

## Inputformat

Verktyget läser en rå textfil med formatet:

```
Namn | URL | Stad | Kategori | Insamlad | Notis
```

Exempel (RawSources20260404.md-format):
```
ABF | https://www.abf.se | Stockholm | förening | 2026-04-04 | Studieförbund
AIK | https://www.aik.se | Stockholm | idrott | 2026-04-04 | Fotbollsklubb
```

## Deduplikationsregler

Två rader anses vara samma källa om de har samma **canonical URL**.

Canonicalisering av URL:
1. Strippa protokoll (`http://` och `https://`)
2. Strippa `www.`-prefix
3. Strippa avslutande `/`
4. Strippa path om den är tom (root = `/`)
5. Konvertera till lowercase

Exempel: `https://www.ARKitekturgalleriet.se/` → `arkitekturgalleriet.se`

## sourceId-generering

sourceId genereras som:
1. Extrahera canonical hostname
2. Strippa landsuffix (`.se`, `.no`, `.dk`, `.fi`)
3. Ersätt specialtecken (`å`→`a`, `ä`→`a`, `ö`→`o`, `-`→`-`, `_`→`-`)
4. Ta lowercase
5. Om resultat börjar/slutar med `-`, ta bort det
6. Om `preferredPath` redan finns för hostname, behåll det

Exempel: `AIK.se` → `aik`

## Idempotenskrav

- Kör samma importfil två gånger → exakt samma output båda gångerna
- Verktyget **skriver aldrig direkt till `sources/`**
- Verktyget producerar endast en `import-preview.jsonl`
- Nästa steg (manuell granskning) avgör om preview accepteras

## Output

Verktyget skapar:
- `import-preview.jsonl` — alla deduplicerade sources med:
  - `sourceId`
  - `canonicalUrl`
  - `name`
  - `city`
  - `type`
  - `dedupeKey` (den canonicaliserade URL som användes för dedup)
  - `isDuplicate` (boolean — true om denna rad var en dup av en tidigare)
  - `originalRows` (array med namn från alla rader som slog ihop till denna source)

## Vad verktyget ÄNNU INTE gör

- [ ] Skriver inte till `sources/`
- [ ] Kontrollerar inte mot befintliga `sources/*.jsonl`
- [ ] Sätter inte `preferredPath` eller `discoveredAt`
- [ ] Hanterar inte case-insensitiv name-dedup (endast URL-dedup)
- [ ] Ingen batch-orienterad import med flera filer
- [ ] Ingen merge med befintlig `runtime/sources_reset_state.jsonl`

## Exempel

```bash
npx tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts \
  --input 01-Sources/RawSources/RawSources20260404.md \
  --output runtime/import-preview.jsonl
```
