# C-htmlGate

**⚠️ VIKTIGT:** För en snabb, sann statusöversikt över C-spårets komponenter, se [C-status-matrix.md](./C-status-matrix.md).

HTML extraction layer using DOM heuristics — the fallback when no JSON-LD and no viable API endpoint is available.

## Pipeline

**NUVARANDE IMPLEMENTATION:** C0→C1→C2→extractFromHtml() → C3-aiExtractGate(fallback)

**CANONICAL MÅLMODELL:** C1→C2→C3→C4-AI

C-htmlGate är en tre-stegs pipeline plus fallback:

1. **C0-htmlFrontierDiscovery** (Legacy/Current) — Hittar interna event-candidate pages via bounded link crawling. Mäter density, väljer bästa candidate.
   - `discoverEventCandidates()` i `C0-htmlFrontierDiscovery/`
   - **C0 motsvarar det som canonical målmodell kallar C1 (Discovery/Frontier)**
2. **C1-preHtmlGate** — Pre-filtering via billig fetch + DOM-analys. Avgör om sida är html_candidate, render_candidate, eller manual_review.
   - `screenUrl()` i `C1-preHtmlGate/`
3. **C2-htmlGate** — Weighted scoring + candidate quality assessment. Gör routingbeslut (promising/maybe/unclear/low_value).
   - `evaluateHtmlGate()` i `C2-htmlGate/`
4. **extractFromHtml()** — Faktiska HTML-extraktionen. Första platsen där events extraheras. Finns i `F-eventExtraction/extractor.ts`.
5. **C3-aiExtractGate** (AI-fallback) — Körs ENBART när C2=promising MEN extractFromHtml()=0 events. Detta är C4-AI-rollen i canonical modell, inte C3.

**VIKTIGT:** I nuvarande implementation är C3 i praktiken `extractFromHtml()`. `C3-aiExtractGate.ts` är AI-fallback (C4-AI). Canonical C3 (HTML-extraktion) implementeras av `extractFromHtml()`, inte av C3-aiExtractGate.

## Tools

Reference implementations in `services/ingestion/src/tools/C-htmlGate/`.

## Version History

- **v2.2** (current): Precision calibration — weighted scoring, noise reduction
- **v2.1**: Candidate list quality assessment
- **v2.0**: Initial two-step split (C1/C2)

## Decision Logic
C-htmlGate (som C-kandidat) testas när:
- No JSON-LD found on root ELLER på event-candidate subpages
- No viable feed discovered via B-JSON-feedGate (inkl. subpages)
- Page renders events client-side via DOM manipulation

C-htmlGate är VERKLIGT verifierad först när:
- extractFromHtml() har gett events > 0

C-htmlGate är fortfarande C-kandidat om:
- C1 säger "html_candidate" men extractFromHtml() = 0 events

**Viktigt:** C ska INTE väljas före A+B har testats på subpages.

## Current Status

**Under development.** `C-htmlGate.ts` exists with active version history. The C1/C2 split is in place. Confidence scoring and noise reduction have been iteratively refined across v2.0–v2.2. Full integration into the ingestion pipeline is ongoing.

---

## C-htmlGate Batch-Loop (LEGACY/PLANERAD — EJ AKTIV)

**⚠️ Denna sektion beskriver planerad funktion, inte aktiv implementation.**

Batch-loop konceptet (10 kandidater → baseline → AI-analys → re-run → jämför) dokumenterades men kördes aldrig med förbättringscykler (`cyclesCompleted=0` i batch-state.jsonl).

### Batch-Loops Arbetssätt (Planerad)

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
