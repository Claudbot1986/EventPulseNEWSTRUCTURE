# 00A — ImportRawSources Tool

## Syfte

Verktyget importerar råa source-listor till deduplicerade canonical sources.
Detta är **endast ett importverktyg** — det skriver inte direkt till `sources/`.

## SÄKERHETSREGLER (hårda)

### 1. Append-only — importpreview ersätter ALDRIG sources/

**Hård regel:** `importpreview.jsonl` får **aldrig** representera ett replacement set för `sources/`.
 verktyget är designat för att endast lägga till — aldrig minska eller ersätta.

**Tillåtna matchStatus i preview:**
- `new` — ny source, skall läggas till i sources/ (även om den har `requiresManualReview`-flagga)
- `matched_existing` — matchar befintlig, behåller befintlig, inget skrivs
- `duplicate_in_import` — ignoreras, påverkar inte sources/
- `invalid_raw_row` — kasseras, når aldrig preview
- `skipped_already_imported_file` — hoppas över, når aldrig preview

**Viktigt:** `manualreview` är nu en **tagg/flagga** (`requiresManualReview`), inte ett eget matchStatus.
En source med `matchStatus='new'` och `requiresManualReview=true` skrivs fortfarande till `sources/` — den är bara
markerad för manuell granskning under ingestion.

**matchStatus kan endast vara:** `new` | `matched_existing` | `duplicate_in_import`
**manualreview som värde existerar inte i matchStatus — det är enbart en tagg i `reviewTags[]`.**

**Om preview innehåller något annat statusvärde → verktyget avbryter med:**
```
[SECURITY ABORT] append-only guard triggered:
  File:  runtime/import-preview.jsonl
  Source: example.se
  Status: 'replacement_candidate' — NOT in allowed append-only list
  Message: importpreview is NEVER a replacement set for sources/.
```

### 2. Backup före import

**Varje 00A-körning backar upp nuvarande `sources/` innan någon importlogik börjar.**

- Backup-plats: `00-Sources/tmp/old-sources-after-00A-imports/`
- Backup-namn: `Old-sources-YYYYMMDD-HHmmss.tar.gz`
- Format: `tar.gz` — inga kolon i filnamnet
- **Om backup misslyckas → abortar importen helt**
- Om `sources/` inte finns → skippar backup (inte fel)

**Logg-exempel:**
```
[00A] Step 0: Pre-import backup of sources/

[BACKUP] SUCCESS
  Path:            /Users/.../NEWSTRUCTURE/00-Sources/tmp/old-sources-after-00A-imports/Old-sources-20260406-214300.tar.gz
  Sources files:   420
  Archive size:    892.1 KB
```

## Inputformat
```
| Namn | URL | Stad | Kategori | Insamlad | Notis |
| ABF | https://www.abf.se | Stockholm | förening | 2026-04-04 | Studieförbund |
```

## Source-identitetsregel: site-level

**I detta steg är source-identitet SITE-LEVEL, inte path-level.**

Två URLs på samma sajt (hostname) behandlas som samma source:
- `https://www.liseberg.se/`
- `https://liseberg.se/evenemang/`
- `https://www.liseberg.se/biljetter`
→ alla → **1 source** med identity key `liseberg.se`

**Varför:** RebuildPlan.md säger att `sources/` är canonical truth.
Om varje subpath på samma sajt skapade en egen source, skulle sajter med
events på `/kalender/`, `/evenemang/`, `/program/` etc. skapa många duplicerade
sources. Site-level deduplication håller antalet nere.

**Edge case — TODO:** Om samma hostname har helt olika event-utbud på olika paths
(t.ex. en sajt med två separata evenemangsavdelningar) kan site-level deduplication
dölja detta. I nuläget är regeln: site-level vinner. Manuell granskning av
preview kan fånga sådana fall.

## Två-nivå URL-system

### sourceIdentityKey
Site-level identity för deduplication och matchning. Endast hostname.
Format: `liseberg.se`, `aik.se`, `ungateatern.se`

### canonicalUrl
Representativ URL med path för audit. Visar vilken URL som valdes.
Format: `liseberg.se/`, `liseberg.se/evenemang`

## Deduplikeringsregler

### 1. Matchning mot befintliga `sources/*.jsonl`

Verktyget läser alla befintliga `sources/*.jsonl` och indexerar på siteIdentityKey.
För varje importerad rad: om siteIdentityKey matchar en befintlig source →
`matchStatus = matched_existing` (behåller befintligt id).

### 2. Intern import-dedup

Två rader med samma siteIdentityKey inom samma importbatch slås ihop.
Båda bevaras i `originalRows[]` och `isDuplicate = true`.

## RawSources-mappen

Mappen `01-Sources/RawSources/` fungerar som en **dumpmapp** för råa source-listor.
Inga krav finns på filnamn förutom att de ska vara markdown-tabeller med rätt kolumner.

00A kan läsa:
- **En enskild fil:** `--input 01-Sources/RawSources/RawSources20260404.md`
- **Alla filer i mappen:** `--all --output runtime/import-preview.jsonl`

## Idempotens: raw-import-manifest.jsonl

Varje importerad fil loggas i `runtime/raw-import-manifest.jsonl` med:
- Filens SHA256-hash
- Filstorlek
- Importdatum
- Radantal

**Idempotensregler:**
- Samma filhash → filen hoppas över som redan importerad
- Samma innehåll, annat filnamn → hoppas över som duplicat
- Ny fil, nytt innehåll → importeras normalt

## Spårbarhet: varje rå rad är spårbar

Varje rå rad i en importfil får **exakt ett explicit utfall** (row-level traceability).

`provenanceRows[]` på varje `ImportedSource` innehåller alla rader som bidrog till den source. Ingen source har någonsin tom `provenanceRows`.

|| rowOutcome | Betydelse | Påverkar source? |
|------------|-----------|------------------|
| `new_row` | Ny source, ingen match i `sources/`, ingen konflikt | ✓ skrivs till `sources/` |
| `new_row_needs_review` | Ny source som är flaggad för manuell granskning (name/city-konflikt med hostname-match) | ✓ skrivs med `requiresManualReview=true` |
| `matched_existing_row` | Matchar en befintlig source i `sources/` | ✗ behåller befintlig |
| `duplicate_row_in_batch` | Samma hostname i samma importfil | ✗ ignoreras |
| `skipped_already_imported_file` | Hela filen hoppades över (redan importerad) | ✗ aldrig i pipeline — provenance sparas i `.skipped-provenance.jsonl` |
| `invalid_row` | Rad saknar giltig URL eller har för få kolumner | ✗ aldrig i pipeline — provenance sparas i `.invalid-provenance.jsonl` |

**Reconciliation:** `validRows + invalidRows = totalSeenRows` — alltid.

**Provenance-filer:**
- `import-preview.jsonl` — varje source har `provenanceRows[]` med alla bidragande rader
- `import-preview.invalid-provenance.jsonl` — en rad per ogiltig rad
- `import-preview.skipped-provenance.jsonl` — en rad per hoppad filrad (idempotens)

## Match-status

|| Värde | Betydelse |
|-------|--------|-----------|
| `new` | Ingen match i befintliga `sources/`, ingen dup i import |
| `matched_existing` | siteIdentityKey matchar en befintlig source i `sources/` |
| `duplicate_in_import` | Samma siteIdentityKey inom importbatchen |

**`manualreview` är INTE ett matchStatus.** Det är enbart en **tagg/flagga** på source-nivå.
Se `requiresManualReview` och `reviewTags` nedan.

## sourceId-regler

**Matched existing:** Behåller befintligt `id` från `sources/*.jsonl`.

**Nya sources:** Genereras från siteIdentityKey:
1. Strippa `.se`, `.no`, `.dk`, `.fi`, `.nu`
2. Ersätt svenska tecken (å→a, ä→a, ö→o)
3. Ersätt `_` och `-` med `-`
4. Strippa ledande/avslutande `-`
5. Max 40 tecken

## Output: import-preview

Verktyget skapar `import-preview.jsonl`:

```json
{
  "sourceId": "liseberg",
  "sourceIdentityKey": "liseberg.se",
  "canonicalUrl": "liseberg.se/",
  "name": "Liseberg",
  "city": "Göteborg",
  "type": "nöje",
  "discoveredAt": "2026-04-06",
  "note": "Test: root URL",
  "isDuplicate": true,
  "originalRows": [
    { "name": "Liseberg", "url": "https://www.liseberg.se" },
    { "name": "Liseberg Evenemang", "url": "https://liseberg.se/evenemang/" },
    { "name": "Liseberg Biljetter", "url": "https://www.liseberg.se/biljetter" }
  ],
  "matchStatus": "matched_existing",
  "matchedBy": "sourceIdentityKey",
  "existingSource": {
    "id": "liseberg",
    "name": "Liseberg (nöje)",
    "preferredPath": "unknown"
  }
}
```

## Statistik

```
Raw rows parsed:       8
NEW sources:           1
MATCHED existing:      4
DUPLICATE rows:        3   ← antal RADER som var duplikat
Total output sources:  5   ← antal unika output-sources
```

**Viktigt:** `DUPLICATE rows` räknar hur många RADER som var duplikat (ej hur många
sources som har duplicerade rader). `Total output sources` är antalet unika sources.

## URL-normaliseringsexempel

| Input | sourceIdentityKey | canonicalUrl |
|-------|-------------------|--------------|
| `https://www.liseberg.se/` | `liseberg.se` | `liseberg.se/` |
| `https://liseberg.se/evenemang/` | `liseberg.se` | `liseberg.se/evenemang` |
| `http://WWW.LISEBERG.SE/` | `liseberg.se` | `liseberg.se/` |
| `https://AIK.se` | `aik.se` | `aik.se/` |
| `https://www.nyttest.se` | `nyttest.se` | `nyttest.se/` |

## Vad verktyget gör

- [x] Läser råa markdown-tabell-filer
- [x] Site-level source identity (hostname)
- [x] Genererar stabila sourceIds för nya sources
- [x] Deduplicerar inom importfilen (site-level)
- [x] Matchar mot befintliga `sources/*.jsonl` (site-level)
- [x] Korrekt statistik: duplicate_rows vs output_sources
- [x] Presenterar alla original-rader i `originalRows[]`
- [x] Separerar `sourceIdentityKey` (för dedup) och `canonicalUrl` (för audit)

## Vad verktyget ÄNNU INTE gör

- [ ] Skriver inte till `sources/`
- [ ] Gör inte merge med `runtime/sources_reset_state.jsonl`
- [ ] Sätter inte `preferredPath` för nya sources
- [ ] Sätter inte `discoveredBy` för nya sources
- [ ] Hanterar inte case-insensitiv name-dedup (endast site-level URL)
- [ ] Manuell granskning krävs för att godkänna preview innan faktisk import
- [ ] Ingen idempotenskontroll mot befintliga canonical sources (samma import kan köras flera gånger)

## Idempotenskrav

- Samma importfil körs två gånger → **identisk output** (samma antal sources, samma sourceIds, samma matchStatus)
- Verktyget påverkar **inte** befintliga `sources/*.jsonl`
- Nästa steg: manuell granskning av preview, sedan eventuell merge
- **Kritiskt:** `readExistingSources()` sorterar filer alfabetiskt för deterministisk ordning vid site-level-kollisioner (t.ex. två filer med samma hostname)

## Write-step: --apply-new

### Steg 1: Generera preview (preview-only)
```bash
npx tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts \
  --input 01-Sources/RawSources/RawSources20260404.md \
  --output runtime/import-preview.jsonl
```

### Steg 2: Granska preview
Granska `runtime/import-preview.jsonl` noga:
- Vilka är `new`? → dessa läggs till i sources/
- Vilka är `matched_existing`? → inget skrivs
- Vilka är `manualreview`? → kräver manuellt beslut

### Steg 3: Skriv new-sources till sources/ (med --apply-new)
```bash
npx tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts \
  --input 01-Sources/RawSources/RawSources20260404.md \
  --output runtime/import-preview.jsonl \
  --apply-new
```

### Säkerhetsregler för write-step

**Endast `matchStatus = "new"` skrivs till sources/.**
`manualreview` är en **tagg/flagga**, inte ett blockerande matchStatus.
Alla andra matchStatus ignoreras helt för write:

| matchStatus | Write? | Åtgärd |
|-------------|--------|--------|
| `new` | ✓ JA | Ny fil `{sourceId}.jsonl` skapas (även om `requiresManualReview=true`) |
| `matched_existing` | ✗ IGNORED | Behåller befintlig, inget skrivs |
| `duplicate_in_import` | ✗ IGNORED | Ignoreras |
| `invalid_raw_row` | ✗ aldrig i preview | Kasserad före preview |
| `skipped_already_imported_file` | ✗ aldrig i preview | Hoppad före preview |

**Flaggor på nya sources:**

| Flagga | Betydelse |
|--------|-----------|
| `requiresManualReview: true` | Source skrivs men behöver manuell granskning under ingestion |
| `reviewTags` | T.ex. `["manualreview", "name_conflict"]` — varför den är flaggad |
| `conflictVariant` | Om hostname matchade befintlig source men med annat name/city: unik sourceId skapas. **Numreringen är persistent över batchar** — `findNextConflictVariant()` söker igenom både befintliga filer i `sources/` och reserverade IDn i aktuell batch |

**Atomär write:**
1. Backup av `sources/` tas före write
2. Write sker till temp-katalog, sedan rename (atomärt på POSIX)
3. Om något går fel → full rollback, inga filer lämnas i inkonsekvent tillstånd
4. Om filen `{sourceId}.jsonl` redan finns → ABORT (inget överskrivande)

### Write-resultat (exempel)

```
[WRITE] Write plan:
  Total new sources to write: 4
    clean new (no flags):         3
    flagged (needs review):       1 — will be written with requiresManualReview=true
  matched_existing: 297 — IGNORED (no write)
  Files to create: 4

[WRITE] SUCCESS — 4 new sources written to sources/
  + clean-source-1.jsonl
  + clean-source-2.jsonl
  + clean-source-3.jsonl
  + conflict-source-conflict-1.jsonl  ← has requiresManualReview=true
```

### Checklista före write
- [ ] Granska import-preview.jsonl
- [ ] Bekräfta att `matched_existing` och `duplicate_in_import` ignoreras vid write
- [ ] Verifiera att `requiresManualReview`-flaggade sources är avsiktligt flaggade
- [ ] Verifiera att alla nya sources har unika sourceIds (inga filkonflikter)
- [ ] Kör med --apply-new
- [ ] Bekräfta att sources/ nu har fler filer (aldrig färre)
- [ ] Bekräfta att befintliga filer inte har ändrats
- [ ] Bekräfta att runtime/sources_status.jsonl inte har ändrats

## Användning

```bash
npx tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts \
  --input 01-Sources/RawSources/RawSources20260404.md \
  --output runtime/import-preview.jsonl \
  --sources-dir sources/
```