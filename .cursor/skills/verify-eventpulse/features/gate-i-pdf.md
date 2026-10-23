# Gate I — pdf-extrahering

## Sub-features

- **Källa** — läser `sources/*.jsonl` direkt (inte en kö) och letar efter
  `pdfUrls`, `programPdf` eller `pdfUrl` på posten.
- **Utdata** — **append** till `runtime/postTestC-UI.jsonl` (`:282`), inte
  till en egen fil. PDF-events hamnar alltså i samma kö som C-gatets.
- **JSON-rapport i stdout** — `{totalSources, processedSources, totalPdfs,
  totalEvents, firstError}`.
- **`--limit` / `--concurrency`** — `:350`.
- **Per-PDF-fel är icke-fatala** — 404/ogiltig PDF loggas i `firstError` och
  körningen fortsätter; exit 1 reserveras för riktigt fatala fel (`:356-375`).

## How to get to it (user POV)

En venue publicerar sitt program som PDF istället för HTML — en teater med
tryckt säsong, en förening med ett utskick. Du kör:

```bash
npx tsx 02-Ingestion/I-pdfExtraction/pdfExtractor.ts --limit 50 --concurrency 3
```

och vill se hur många källor som hade PDF:er, hur många PDF:er som laddades
ner, och hur många evenemang som extraherades.

## Driving it

```bash
cd /Users/claudgashi/EventPulse
TIMED="$PWD/.cursor/skills/verify-eventpulse/scripts/timed.sh"

# Läs först vilka källor som faktiskt har pdfUrls — annars är det 0 rader
# som gör jobbet.
grep -l '"pdfUrls"\|"programPdf"\|"pdfUrl"' sources/*.jsonl | head -5
jq -c '{id, url, pdfUrls, programPdf, pdfUrl}' $(grep -l '"pdfUrls"\|"programPdf"\|"pdfUrl"' sources/*.jsonl | head -1)

wc -l runtime/postTestC-UI.jsonl        # FÖRE
sh "$TIMED" 600 npx tsx 02-Ingestion/I-pdfExtraction/pdfExtractor.ts --limit 3 --concurrency 1
echo "exit=$?"
wc -l runtime/postTestC-UI.jsonl        # EFTER — ska ha vuxit
```

## Gotchas

**Gate I har ingen sandbox.** `pdfExtractor.ts:37-39` hårdkodar
`join(PROJECT_ROOT, 'sources'/'runtime')`. `EVENTPULSE_SANDBOX_ROOT` läses
inte, och en körning appendar till repots riktiga `postTestC-UI.jsonl`.
Räkna antalet före, kör med `--limit 1`, och rapportera att live-filen
ändrades om du körde den.

**Bar invocation är en tyst no-op.** Entrypoorten är skyddad av
`if (isMainModule && cliArgs.length > 0)` (`:356`). Utan argument avslutar
programmet utan att göra något och utan felmeddelande. Skicka alltid minst
`--limit 1`.

**Utdata appendas till `postTestC-UI.jsonl`.** Filen ägs gemensamt med
C-gatet. Kör inte I parallellt med C på samma `runtime/`.

**Tom `sources/` med pdf-fält ger en rad, inte ett fel:**
`[pdfExtractor] no sources with pdfUrls/programPdf/pdfUrl found in sources/`
(`:307`) och exit 0. Det betyder "inga PDF-källor", inte "extraction
fungerar inte".

**`firstError` kan vara sann utan att exit blir 1.** En blandad körning med
några trasiga PDF:er ger `totalEvents > 0` *och* `firstError: "..."`. Läs
båda fälten.

**Gate I saknar count-recipe i cron-parsern.** Dess `eventsExtracted` i
`runtime/ingestion-cron.status.json` är alltid `null` — läs JSON-rapporten i
stdout.