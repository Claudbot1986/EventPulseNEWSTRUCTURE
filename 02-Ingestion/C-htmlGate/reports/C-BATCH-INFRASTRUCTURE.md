# C-htmlGate Batch Infrastructure

**Document Type: HISTORICAL / LEGACY REFERENCE**
**Status: INAKTIV — Förbättringsloopen kördes aldrig**

> **DENNA FIL ÄR HISTORISK. LÄS INTE DENNA FIL SOM AKTIV DOKUMENTATION.**
>
> **VAD DETTA ÄR:** Dokumentation av en planerad batch-infrastruktur som ALDRIG kördes i sin tänkta form.
> - `cyclesCompleted=0` — förbättringsloopen kördes aldrig
> - `preRunResults=null` — baseline kördes men sparades inte
> - `postRunResults=null` — inga förbättringscykler
>
> **Batch-script (run-batch-001.ts etc.) är legacy engångs-test, inte aktiv pipeline.**
>
> **Ersättande filer:**

| Behöver du... | Läs istället... |
|---------------|-----------------|
| Batch-workflow | [123.md](../123.md) (Steg 1b) |
| Batch-status och cycles | [C-rebuild-plan.md](../C-rebuild-plan.md) |
| Canonical målmodell | [C-testRig1-2-3loop.md](../C-testRig1-2-3loop.md) |
| Snabböversikt | [C-status-matrix.md](../C-status-matrix.md) |

---

**Historisk anmärkning:**
- Om batch-loop återupptas, skriv ny infrastrukturdokumentation baserad på `C-rebuild-plan.md` och `C-testRig1-2-3loop.md`
- Batch-state.jsonl (`batch-state.jsonl`) finns kvar som historisk datafil med `status=completed` och `cyclesCompleted=0`
- Alla batch-rapporter finns i `02-Ingestion/C-htmlGate/reports/batch-{N}/`
