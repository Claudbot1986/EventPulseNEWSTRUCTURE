# C-htmlGate Batch {BATCH_N} Rapport

**Document Type: TEMPLATE / PLANERAD**
**Status: DOKUMENTERAD**

> **VAD DETTA ÄR:** Mall för batch-rapporter.
> **VAD DETTA INTE ÄR:** Faktisk körning. Användes aldrig i förbättringsloop-format.

**Batch-ID:** batch-{BATCH_N}  
**Datum:** {DATUM}  
**Status:** {STATUS}

## Översikt

| Metric | Värde |
|--------|-------|
| Sources i batch | {ANTAL} |
| Före-events (totalt) | {FORE_TOTAL} |
| Efter-events (totalt) | {EFTER_TOTAL} |
| AI-analys genförbättring | {AI_IMPROVEMENT} |

## Sources i denna batch

| Källa | Före | Efter | Delta | AI-analys |
|-------|------|-------|-------|-----------|
| {SOURCES_TABLE_ROWS} |

## AI-analys och modellförbättring

### Generella mönster identifierade
- {PATTERNS}

### Förbättringar föreslagna
- {IMPROVEMENTS}

### Förbättringar implementerade
- {IMPLEMENTED}

### Site-specifika observationer (ej i C-lager)
- {SITE_SPECIFIC}

## Batch-koppling

**Batchrapport:** `batch-{BATCH_N}-{DATUM}.md`  
**Källrapporter:** `sources/{SOURCE_ID}.md` (en per källa)

## Nästa steg

- {NEXT_STEPS}