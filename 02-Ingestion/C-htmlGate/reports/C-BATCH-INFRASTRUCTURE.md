# C-htmlGate Batch Infrastructure

## Översikt

C-htmlGate batch-loop är systematiskt iterationsarbete för att förbättra den generella HTML-modellen genom att testa 10 C-kandidater åt gången.

## Batch-state.jsonl

**Sökväg:** `02-Ingestion/C-htmlGate/reports/batch-state.jsonl`

**Struktur:**
```json
{
  "currentBatch": 1,
  "batchSize": 10,
  "status": "idle|pending|testing|completed",
  "batchSources": ["src1", "src2", ...],
  "completedBatches": [1, 2, ...],
  "lastBatchRun": "ISO timestamp"
}
```

**Status-regler:**
- `idle` → nästa 123 kan köra batch
- `pending` → batch förberedd men ej bekräftad
- `testing` → batch körs just nu
- `completed` → batch klar, nästa 123 tar nästa batch

## C-kandidatklassning

**Kriterier för C-batch (INKLUDERA):**
- `triageResult = "html_candidate"` — C1 identifierade HTML-event
- `status ∈ {"fail", "triage_required"}` — HTML-path testad
- `pendingNextTool = "html_extraction_review"` — väntar C-förbättring
- `lastEventsFound = 0` — extraction gav 0 events

**Exkludera:**
- `status = "success"` → A/B-verifierade
- `preferredPath ∈ {"network", "api", "render"}` → redan-pathbestämda
- `pendingNextTool = "D-renderGate"` → D-pending
- `triageResult = "manual_review"` → manuell granskning
- `status = "pending_api"` → API-källa

## Rapportstruktur

**Batch-rapport:** `02-Ingestion/C-htmlGate/reports/batch-{N}/batch-{N}-report.md`
**Källrapporter:** `02-Ingestion/C-htmlGate/reports/batch-{N}/sources/{sourceId}.md`

## Workflow i 123 (se ~/.hermes/skills/123/SKILL.md Steg 1b)

1. Läs batch-state.jsonl → currentBatch + status
2. Om completed → inkrementera currentBatch, reset status
3. Om batch redan completed → hoppa
4. Hämta 10 C-kandidater (enligt filter ovan)
5. Kör C-htmlGate baseline → före-resultat
6. AI-analys → föreslå generaliserbar förbättring (3+ sajter)
7. Applicera förbättring om generaliserbar
8. Kör C igen → efter-resultat
9. Spara batchrapport + källrapporter
10. Uppdatera batch-state.jsonl → completed

## Batch 001 Status

Batch 001 har 10 C-kandidater valda enligt ovan filter. Totalt finns 15 C-kandidater i kön, så batch 002 kan väljas direkt efter att 001 är klar.

**Nästa körning:** 123 kan välja nästa 10 från kön (polismuseet, stockholm-jazz-festival-1, svenska-fotbollf-rbundet, uppsala-kommun, ystad, plus 5 från samma kategori).