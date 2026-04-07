# INSTRUCTIONS — 00A-ImportRawSources-tool

## Vad verktyget gör

Läser alla råa source-listor från `01-Sources/RawSources/` och importerar dem till `sources/`.
Verktyget deduplicerar, matchar mot befintliga sources, och presenterar resultatet i `runtime/import-preview.jsonl`.
Med flaggan `--apply-new` skrivs nya sources också till `sources/` (append-only).

## Automatisk filinläsning

Flaggan `--all` gör att verktyget automatiskt läser **alla** filer i `01-Sources/RawSources/`:

```
01-Sources/RawSources/
  RawSources20260404.md       ← läses
  RawSources-write-test.md    ← läses
  _batch_goteborg.txt         ← läses
  _batch_malmo_lund_helsingborg.txt  ← läses
  _batch_mellanstora_stader.txt      ← läses
  _batch_stockholm.txt               ← läses
  _batch_uppsala_vasteras_orebro_linkoping.txt ← läses
```

Filtreringsregler tillämpas automatiskt:
- **Redan importerade filer** — hoppas över (idempotens via SHA256-hash)
- **Filer som inte matchar mönstret** — hoppas över (`RawSources*.md` eller `_batch_*.txt`)

## Säkerhet: append-only

Verktyget skriver **aldrig** över eller tar bort befintliga sources.
- Nya sources läggs till i `sources/{sourceId}.jsonl`
- Befintliga sources behålls intakta
- `runtime/import-preview.jsonl` ersätter aldrig `sources/`

## Säkerhet: backup före import

Innan någon importlogik körs skapas en backup av `sources/`:
- Plats: `00-Sources/tmp/old-sources-after-00A-imports/Old-sources-YYYYMMDD-HHmmss.tar.gz`
- Om backup misslyckas → avbryts importen helt
- Detta garanterar att inget går förlorat

## Så här startar du verktyget

```bash
npm run import:sources
```

Detta kör:
```
tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts \
  --all --output runtime/import-preview.jsonl --apply-new
```

### Förhandsgranskning (utan att skriva till sources/)

```bash
npx tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts \
  --all --output runtime/import-preview.jsonl
```

## Outputfiler

| Fil | Innehåll |
|-----|----------|
| `runtime/import-preview.jsonl` | Alla importerade sources (ny + befintliga) |
| `runtime/00A-file-scan-report.jsonl` | En rad per fil i RawSources/ — fullständig filnivå-redovisning |
| `runtime/import-preview.invalid-provenance.jsonl` | Rader som var ogiltiga |
| `runtime/import-preview.skipped-provenance.jsonl` | Rader från redan importerade filer |
| `00-Sources/tmp/old-sources-after-00A-imports/*.tar.gz` | Backup av sources/ före import |

Varje rad i `00A-file-scan-report.jsonl` innehåller:
`fileName`, `filePath`, `scanOutcome`, `reason`, `fileSize`, `fileHash`, `previouslyImportedAt` (om relevant)

## Hur du vet att det fungerade

### 1. Backup skapades
```
[BACKUP] SUCCESS
  Path:  .../Old-sources-20260407-XXXXXX.tar.gz
```

### 2. Inga sources försvann
`sources/`-antalet ökade eller var oförändrat — aldrig minskat.

### 3. Redan importerade filer hoppades över
```
SKIP (already imported): RawSources20260404.md
  Previously imported: 2026-04-06T18:50:19.572Z
```

### 4. Nya sources fick `ingestionStage: pending`
Varje ny source i `sources/{sourceId}.jsonl` ska ha:
```json
"ingestionStage": "pending"
```
Kontrollera med:
```bash
grep -l '"ingestionStage"' sources/*.jsonl | wc -l
```

### 5. Reconciliations raden stämmer
```
Reconciliation: 363 total seen = 363 accounted for: YES ✓
```

## Krav på filer i RawSources

Filerna måste:
- Vara markdown-tabeller med rätt kolumner
- Kolumner: `Namn`, `URL`, `Stad`, `Kategori`, `Insamlad`, `Notis`
- Namnges `RawSources*.md` eller `_batch_*.txt`

Exempel:
```
| Namn | URL | Stad | Kategori | Insamlad | Notis |
| ABF | https://www.abf.se | Stockholm | förening | 2026-04-04 | Studieförbund |
```

## Kommandoradsflaggor

| Flagga | Betydelse |
|--------|-----------|
| `--all` | Läs alla filer i `01-Sources/RawSources/` |
| `--input <fil>` | Läs en enskild fil |
| `--output <fil>` | Outputfil (default: `runtime/import-preview.jsonl`) |
| `--apply-new` | Skriv nya sources till `sources/` |
| `--sources-dir <dir>` | Override för sources-katalog (default: `sources/`) |

`--input` och `--all` kan inte användas tillsammans.
