# pattern-promoter

`02-Ingestion/C-htmlGate/runC-pattern-promoter.ts` — permanentar bekräftade URL-mönster i C0/C2. Triage-steg i cron (`manual-review-triage`-namn).

## Sub-features

- Läser `reports/pattern-validation/validation-*.json` (output från `runC-pattern-validator`)
- För varje `status: 'confirmed'` pattern:
  - Append till `C0-htmlFrontierDiscovery.ts` → `SWEDISH_EVENT_PATTERNS`
  - Append till `C2-htmlGate.ts` → `eventUrlSegments`
  - Append till `reports/pattern-promotions.jsonl`
- `--dry-run` rapporterar utan att skriva
- Respekterar Generalization Protection Rule: bara `confirmed` (verifierat på ≥2 unrelated domains)

## How to get to it (user POV)

Användaren ser pattern-promoter som "nya event-mönster vi lärt oss att känna igen". Effekten är indirekt: framtida C0/C2-körningar matchar fler URLs korrekt → färre manuella reviews → färre events i human-review-queue.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. chain-overview för steget 'manual-review-triage' (inte 'pattern-promoter'!)
jq -r 'select(.event=="step-end" and .step=="manual-review-triage") | "exit=\(.exitCode) duration=\(.durationMs)ms"' \
  runtime/ingestion-cron/chain-overview.log | tail -3

# 2. Senaste log
LATEST=$(ls -t runtime/ingestion-cron/steps/manual-review-triage-*.log 2>/dev/null | head -1)
grep -E "(promoted|skipped|validation|pattern)" "$LATEST" | tail -10

# 3. Promotions-historik
test -f 02-Ingestion/C-htmlGate/reports/pattern-promotions.jsonl && wc -l 02-Ingestion/C-htmlGate/reports/pattern-promotions.jsonl
# → växer över tid (1 rad per promoted pattern)

# 4. Förväntat slut-tillstånd
grep -E "^─── manual-review-triage" "$LATEST" | tail -1
# → exit=0 duration=~5s (tom körning)
```

Bevis: chain-overview step-end + `02-Ingestion/C-htmlGate/reports/pattern-promotions.jsonl` (innehåll).

## Gotchas

**Steg-namnet är `manual-review-triage` i cron**, inte `pattern-promoter` (se `scripts/ingestion-cron.ts:369`). Båda refererar till samma `runC-pattern-promoter.ts` med `--dry-run --limit 20`. Förväxla inte med eventuell "riktig" manual-review-queue (H-manualReview).

**Skriver till C0/C2 source-filer** — promotion ändrar C0 och C2 permanent. `--dry-run` rapporterar bara. Använd `--dry-run` vid verifiering.

**Saknas `VALIDATION_DIR` (första körning)** → scriptet returnerar `null` istället för att krascha (rad 53-60). Både smoke + skarpt kan köra även utan valideringsrapporter.

**Generalization Protection Rule:** pattern måste vara verifierat på ≥2 unrelated domains. `insufficient-data` och `rejected` skip:as automatiskt.

**Append-only till C0/C2** — kör flera gånger kan skapa dubbletter om pattern redan finns. Manuell städning krävs.