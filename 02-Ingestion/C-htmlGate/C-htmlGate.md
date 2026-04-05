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
