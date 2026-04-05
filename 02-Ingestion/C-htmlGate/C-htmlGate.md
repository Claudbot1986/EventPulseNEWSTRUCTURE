# C-htmlGate

HTML extraction layer using DOM heuristics — the fallback when no JSON-LD and no viable API endpoint is available.

## Pipeline

C-htmlGate is a two-step pipeline:

1. **C1-preHtmlGate** — Pre-filtering: removes noise, identifies repetitive event blocks
2. **C2-htmlGate** — Actual HTML extraction: CSS selectors, microdata patterns, common DOM structures

## Tools

Reference implementations in `services/ingestion/src/tools/C-htmlGate/`.

## Version History

- **v2.2** (current): Precision calibration — weighted scoring, noise reduction
- **v2.1**: Candidate list quality assessment
- **v2.0**: Initial two-step split (C1/C2)

## Decision Logic
C-htmlGate (som C-kandidat) testas när:
- No JSON-LD found on root ELLER på event-candidate subpages
- No viable API endpoint discovered via B-networkGate (inkl. subpages)
- Page renders events client-side via DOM manipulation

C-htmlGate är VERKLIGT verifierad först när:
- extractFromHtml() har gett events > 0

C-htmlGate är fortfarande C-kandidat om:
- C1 säger "html_candidate" men extractFromHtml() = 0 events

**Viktigt:** C ska INTE väljas före A+B har testats på subpages.

## Current Status

**Under development.** `C-htmlGate.ts` exists with active version history. The C1/C2 split is in place. Confidence scoring and noise reduction have been iteratively refined across v2.0–v2.2. Full integration into the ingestion pipeline is ongoing.

---

## C-htmlGate Batch-Loop

C-htmlGate används som en **iterativ förbättringsloop** för att validera och förbättra den generella HTML-modellen.

### Batch-Loops Arbetssätt

1. **Ta 10 C-kandidater åt gången** från C-kandidatkön
2. **Kör C-htmlGate en gång** på alla 10 (baseline-förbättring)
3. **AI analyserar** hemsidorna, undersidor och HTML-struktur:
   - Varför C lyckades eller misslyckades
   - Vilka HTML-mönster som verkar generella
   - Vilka förbättringar som bör göras i C-modellen
4. **Kör C igen** på samma 10 (efter förbättring)
5. **Jämför utfall** före och efter
6. **Spara rapport** i `C-htmlGate/reports/`

### Batch-Inkludering

**C-batcher gäller ENDAST C-kandidater:**
- INTE redan verifierade A/B-källor
- INTE D-pending (render-behövande sidor)
- C-kandidat = källa där A+B testats och misslyckats, HTML-extraktion inte verifierad

### Rapportstruktur

Rapporter sparas i `02-Ingestion/C-htmlGate/reports/batch-{N}-{datum}.md`:

```
- antal sources i batch
- före/efter-events per source  
- generella mönster identifierade
- förbättringsförslag (ej site-specifika)
- cross-site verification status
```

**Kompakthetskrav:** Rapporter ska fungera även när 100–200 batchrapporter finns. Inga fullständiga HTML-dumpar.

### Mål

- Utveckla generella HTML-metoder för ~85% av scrapbara HTML-sidor
- INGA site-specifika hacks
- Varje batch bidrar till kunskapsbank för framtida analys
