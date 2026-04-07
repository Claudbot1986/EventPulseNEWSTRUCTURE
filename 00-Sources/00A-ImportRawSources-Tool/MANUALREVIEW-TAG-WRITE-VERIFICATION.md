# MANUALREVIEW-TAG-WRITE-VERIFICATION

## Datum
2026-04-07

## Syfte
Verifiera att `manualreview` nu behandlas som en tagg/flagga istället för ett write-blockerande matchStatus.

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

## MatchStatus vs reviewTags

| Koncept | matchStatus | reviewTags |
|---------|------------|------------|
| Vad det är | Huvudutfall av import-match | Osäkerhets-flagga på en ny source |
| Värden | `new`, `matched_existing`, `duplicate_in_import` | `manualreview`, `name_conflict`, `city_conflict`, `type_uncertain` |
| Används för | Att avgöra om source ska skrivas | Att markera att source behöver granskas |

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

## Säkerhetsgarantier

1. **`matched_existing` skrivs aldrig** — filen `abf.jsonl` förblev oförändrad
2. **`duplicate_in_import` skrivs aldrig** — dupinnehåll bevaras i `originalRows` men genererar ingen extra fil
3. **Filkonflikt → ABORT** — om `sourceId.jsonl` redan finns → write avbryts
4. **Atomär write** — temp-dir + rename, full rollback vid fel
5. **Backup före write** — `Old-sources-YYYYMMDDTHHmmssZ.tar.gz`
6. **sources_status.jsonl oförändrad** — 420 rader före och efter
7. **sources/ endast ökar** — 421 → 425 filer

## Commit
```
Treat manualreview as source tag instead of write blocker in 00A
```
