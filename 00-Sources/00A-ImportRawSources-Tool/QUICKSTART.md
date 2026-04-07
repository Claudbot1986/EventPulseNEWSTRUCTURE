# 00A-import — Snabbguide

## Vad det gör

Läser alla filer i `01-Sources/RawSources/` och importerar dem till `sources/`.
Verktyget hoppar automatiskt över:
- Filer som redan importerats (idempotens via SHA256)
- Filer som inte matchar `RawSources*.md`-mönstret

## Steg

### 1. Lägg råfiler i RawSources

Filerna måste:
- Ligger i `01-Sources/RawSources/`
- Namnges `RawSources*.md`
- Vara markdown-tabeller med kolumnerna: `Namn`, `URL`, `Stad`, `Kategori`, `Insamlad`, `Notis`

### 2. Kör importen

```bash
npm run import:sources
```

Detta kör:
```
tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts --all --output runtime/import-preview.jsonl --apply-new
```

### 3. Output

- `runtime/import-preview.jsonl` — alla importerade sources (preview)
- Nya sources skrivs till `sources/{sourceId}.jsonl`
- Redan importerade filer hoppas över utan fel

## Manuellt köra (för debug/preview utan write)

```bash
# Preview utan att skriva till sources/
npx tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts \
  --all --output runtime/import-preview.jsonl
```

## Verifiering

```bash
# Visa alla RawSources-filer som hittas
npx tsx 00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts --help
```
