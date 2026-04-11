# C-htmlGate

**Document Type: HISTORICAL / LEGACY REFERENCE**
**Status: ANVÄNDS I KOD — men dokumentationen är föråldrad**

> **DENNA FIL ÄR HISTORISK. LÄS INTE DENNA FIL SOM STYRANDE DOKUMENTATION.**
>
> C-htmlGate.md var den ursprungliga C-spår-dokumentationen. Den är nu ersatt av tydligare filer (se nedan).
>
> **Ersättande filer:**

| Behöver du... | Läs istället... |
|---------------|-----------------|
| Snabböversikt och status | [C-status-matrix.md](./C-status-matrix.md) |
| Canonical målmodell | [C-testRig1-2-3loop.md](./C-testRig1-2-3loop.md) |
| Rebuild-plan | [C-rebuild-plan.md](./C-rebuild-plan.md) |
| Workflow execution | [123.md](./123.md) |

---

**Historisk anmärkning:**
- Den pipeline som dokumenterades här (`C0→C1→C2→extractFromHtml()→C3-aiExtractGate`) är legacy och ersatt av canonical modellen (`C1→C2→C3→C4-AI`)
- Den gamla batchloop-beskrivningen kördes aldrig i sin tänkta form (`cyclesCompleted=0`)
- Alla batch-rapporter finns i `02-Ingestion/C-htmlGate/reports/batch-{N}/`
