# MANUALREVIEW-TAG-WRITE-VERIFICATION

## Datum
2026-04-07

## Syfte
Verifiera att `manualreview` nu behandlas som en tagg/flagga istället för ett write-blockerande matchStatus.

## Två-nivå modell: matchStatus vs rowOutcome vs taggar

### Nivå 1: `matchStatus` (source-level import-utfall)
Endast tre värden — strikt typat:

| matchStatus | Betydelse | Skrivs? |
|------------|-----------|---------|
| `new` | Ny source | ✓ JA (med eller utan requiresManualReview) |
| `matched_existing` | Matchar befintlig | ✗ IGNORED |
| `duplicate_in_import` | Dubblett i import | ✗ IGNORED |

### Nivå 2: Taggar (source-level metadata)
Flaggor som följer med in i source-filen:

| Tag | Betydelse |
|-----|-----------|
| `requiresManualReview: true` | Source behöver manuell granskning under ingestion |
| `reviewTags: ['manualreview', ...]` | Varför granskning behövs |
| `conflictVariant: N` | Persistent numrering över batchar |

### Nivå 3: `rowOutcome` (row-level traceability)
Spårbarhet för varje rå rad — separat från matchStatus:

| rowOutcome | Betydelse |
|------------|-----------|
| `new_row` | Rad skapade bidrog till ny source |
| `new_row_needs_review` | Rad → ny source + granskningsflagga |
| `matched_existing_row` | Rad matchade befintlig source |
| `duplicate_row_in_batch` | Rad var intern dublett |
| `skipped_already_imported_file` | Fil var redan importerad |
| `invalid_row` | Rad var ogiltig |

### manualreview-placering
- `matchStatus`: ALDRIG — taggen är borta här
- `reviewTags`: JA — `['manualreview', 'name_conflict', ...]`
- `rowOutcome`: JA — `new_row_needs_review` (när manualreview-taggen är satt)
- `requiresManualReview`: JA — `true` när granskningsflagga behövs

## Ändringsbeskrivning

### Före
- `manualreview` var ett eget `matchStatus` som blockerade write till `sources/`
- `buildWritePlan()` ignorerade poster med `matchStatus === 'manualreview'`
- 00A hade ingen väg att skriva osäkra men nya sources

### Efter
- `manualreview` är nu `requiresManualReview: true` + `reviewTags: ['manualreview', ...]`
- `matchStatus` blir `'new'` + flagga (inte ett separat status)
- `buildWritePlan()` skriver ALLA `'new'` poster — med eller utan flagga
- Flaggan följer med in i source-filen som `requiresManualReview: true`

## matchStatus vs reviewTags vs rowOutcome

|| Koncept | matchStatus | reviewTags | rowOutcome |
|---------|------------|------------|------------|
| Vad det är | Source-level import-utfall | Source-level metadata | Row-level traceability |
| Värden | `new`, `matched_existing`, `duplicate_in_import` | `manualreview`, `name_conflict`, `city_conflict` | `new_row`, `new_row_needs_review`, `matched_existing_row`, `duplicate_row_in_batch`, `skipped_already_imported_file`, `invalid_row` |
| Används för | Att avgöra om source ska skrivas | Att markera att source behöver granskning | Att spåra varje rå rad |

## Testfälle

### Input: RawSources-manualreview-v2.md
```
| Namn | URL | Stad | Kategori | Insamlad | Notis |
| Ren Ny Källa Ver2 | https://ren-ny-kalla-v2-test.se | Teststad | nöje | 2026-04-07 | Clean new v2 |
| Flaggad Conflict V2 | https://flaggad-v2-test.se | Annan Stad | kultur | 2026-04-07 | Name/city conflict v2 |
| Befintlig Källa V2 | https://www.abf.se | Ny Stad | förening | 2026-04-07 | ABF med annan stad |
| Dubblett Intern V2 | https://dubblett-v2-test.se | Teststad | nöje | 2026-04-07 | Rad 1 |
| Dubblett Intern V2 | https://dubblett-v2-test.se | Teststad | nöje | 2026-04-07 | Rad 2 samma |
```

### Förväntat resultat

| Source | matchStatus | requiresManualReview | reviewTags | Skrivs? | Filnamn |
|--------|-------------|---------------------|------------|---------|---------|
| ren-ny-kalla-v2-test | new | false | [] | ✓ JA | ren-ny-kalla-v2-test.jsonl |
| flaggad-v2-test | new | false | [] | ✓ JA | flaggad-v2-test.jsonl |
| abf.se → abf-conflict-1 | new | true | manualreview, name_conflict, city_conflict | ✓ JA | abf-conflict-1.jsonl |
| dubblett-v2-test (dup) | new | false | [] | ✓ JA | dubblett-v2-test.jsonl |
| abf.se (matchad) | matched_existing | - | - | ✗ IGNORED | (ingen fil) |

### Verkligt resultat

```
[WRITE] Write plan:
  Total new sources to write: 4
    clean new (no flags):         3
    flagged (needs review):       1 — will be written with requiresManualReview=true
  Files to create: 4

[WRITE] SUCCESS — 4 new sources written to sources/
  + ren-ny-kalla-v2-test.jsonl
  + flaggad-v2-test.jsonl
  + abf-conflict-1.jsonl
  + dubblett-v2-test.jsonl
```

## Verifiering av flaggad source

### abf-conflict-1.jsonl
```json
{
  "id": "abf-conflict-1",
  "name": "Befintlig Källa V2",
  "city": "Ny Stad",
  "requiresManualReview": true,
  "reviewTags": ["manualreview", "name_conflict", "city_conflict"],
  "metadata": {
    "manualReviewReasons": [
      "name='ABF' vs import name='Befintlig Källa V2'",
      "city='Stockholm' vs import city='Ny Stad'"
    ],
    "existingSourceId": "abf",
    "sourceIdentityKey": "abf.se"
  }
}
```

### ren-ny-kalla-v2-test.jsonl
```json
{
  "id": "ren-ny-kalla-v2-test",
  "name": "Ren Ny Källa Ver2",
  "requiresManualReview": false,
  "reviewTags": [],
  ...
}
```

## Flерbatch-test: conflict-varianter är persisted över batchar

### Syfte
Verifiera att conflict-variantnummer är unika och ökar över flera import-batchar.
`abf-conflict-1` (batch 1) → `abf-conflict-2` (batch 2) → `abf-conflict-3` (batch 3)

### Batch 1: Första konflikt för abf
Input: `abf.se` med stadskillnad
Förväntat: `abf-conflict-1.jsonl`

### Batch 2: Andra konflikt för abf (medan `abf-conflict-1.jsonl` redan finns)
Input: `abf.se` med annat namn
Förväntat: `abf-conflict-2.jsonl` (inte `abf-conflict-1` som skulle krascha)

### Batch 3: Tredje konflikt för abf
Input: `abf.se` med tredje namnet
Förväntat: `abf-conflict-3.jsonl`

### Implementering
```typescript
findNextConflictVariant(baseSourceId, sourcesDir, reservedInBatch)
```
- Söker igenom befintliga filer i `sources/` (persistent över alla tidigare batchar)
- Söker igenom reserverade IDn i aktuell batch (för multipla konflikter i samma batch)
- Returnerar nästa lediga nummer (max + 1)

## Säkerhetsgarantier

1. **`matched_existing` skrivs aldrig** — filen `abf.jsonl` förblev oförändrad
2. **`duplicate_in_import` skrivs aldrig** — dupinnehåll bevaras i `originalRows` men genererar ingen extra fil
3. **Filkonflikt → ABORT** — om `sourceId.jsonl` redan finns → write avbryts
4. **Atomär write** — temp-dir + rename, full rollback vid fel
5. **Backup före write** — `Old-sources-YYYYMMDDTHHmmssZ.tar.gz`
6. **sources_status.jsonl oförändrad** — 420 rader före och efter
7. **sources/ endast ökar** — 421 → 425 filer
8. **`matchStatus='manualreview'` kan inte längre produceras** — typningen tillåter det inte

## Commit
```
Make conflict variants persistent across batches and remove manualreview matchStatus
```
