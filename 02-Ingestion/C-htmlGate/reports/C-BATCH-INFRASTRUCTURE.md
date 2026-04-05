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
  "status": "idle|pending|testing|baseline_only|completed",
  "batchSources": ["src1", "src2", ...],
  "completedBatches": [1, 2, ...],
  "lastBatchRun": "ISO timestamp",
  "cyclesCompleted": 0,
  "maxCyclesAllowed": 3,
  "stopReason": null | "plateau" | "no-general-improvement" | "d-problem" | "max-cycles"
}
```

**Status-regler:**
- `idle` → nästa 123 kan köra batch
- `pending` → batch förberedd men ej bekräftad
- `testing` → batch körs just nu
- `baseline_only` → första körning gjord, förbättringsloop INTE fullföljd — nästa 123 ska fortsätta med AI-analys
- `completed` → batch fullföljd med förbättringsloop (eller bekräftad stopp vid plateau/max-cycles)

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

## Workflow i 123 (se `02-Ingestion/C-htmlGate/123.md` Steg 1b)

```
1. Läs batch-state.jsonl → currentBatch + status + cyclesCompleted
2. Om status = "completed" → inkrementera currentBatch, reset status
3. Om status = "baseline_only" → fortsätt med steg 8 (AI-analys), hoppa inte till ny batch
4. Om batch redan completed → hoppa till nästa batch
5. Hämta 10 C-kandidater (enligt filter ovan)
6. Kör C-htmlGate baseline → före-resultat, spara baseline per källa
7. **FORTSÄTT MED FÖRBÄTTRINGSLOOP:**
8. AI-analys → identifiera generell förbättring (3+ sajter)
   - Om ingen generell förbättring möjlig → stopReason="no-general-improvement" → steg 13
9. Applicera högst EN liten generell modellförbättring
10. Kör C igen → cykel-resultat
11. Jämför: om förbättring → fortsätt, annars → stopReason="plateau" → steg 13
12. Upprepa steg 8-11 (max 3 cykler totalt, cyclesCompleted++)
13. Spara batchrapport (med alla cykler) + källrapporter
14. Uppdatera batch-state.jsonl → status="completed", stopReason, completedBatches
```

**Platå-regler (stopReason):**
- `plateau`: ingen tydlig förbättring vs föregående cykel
- `no-general-improvement`: nästa ändring riskerar att vara site-specifik
- `d-problem`: kvarvarande fail är D/render/manual-problem, ej C
- `max-cycles`: 3 förbättringscykler genomförda

**Batch 001 Status**

Batch 001 har status `baseline_only` — första körning gjord men förbättringsloop EJ fullföljd. Rapporter bevaras som historik. Nästa 123 ska fortsätta med AI-analys (steg 8) för att fullfölja förbättringsloopen.