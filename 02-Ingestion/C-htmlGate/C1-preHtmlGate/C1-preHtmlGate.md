# C1-preHtmlGate — Triage Tool

## Purpose

C1-preHtmlGate är ett **rent triage-verktyg** för sources med status `triage_required`. Den ger snabb, billig HTML-screening INNAN fullständig event-extraction.

## Role

**VAD C1 GÖR:**
- Screening av okända sources via billig fetch + DOM-analys
- Returnerar tydliga triage-utfall (TriageResult)
- Avgör om en sida är HTML-event-källa, JS-renderad, eller kräver manuell granskning

**VAD C1 INTE GÖR:**
- Extraherar inte events fullständigt
- Ersätter inte C2/C3
- Körs INTE före routing för alla sources
- Fattar inte slutgiltiga routingbeslut

## Triage Outcomes

| Outcome | Betydelse | Nästa steg |
|---------|-----------|------------|
| `html_candidate` | Sida ser ut som HTML-event källa | Proceed med HTML extraction |
| `render_candidate` | Sida är sannolikt JS-renderad | Parkera för D-renderGate |
| `manual_review` | Kan inte avgöra automatiskt | Kräv mänsklig granskning |
| `still_unknown` | Kan inte hämta sidan | Försök igen senare |

## Position in Pipeline

```
triage_required source
       ↓
C1-preHtmlGate.screenUrl() ← ENDAST hit för okända sources
       ↓
determineTriageOutcome()
       ↓
┌─────────────────────────────────────┐
│ html_candidate → HTML extraction   │
│ render_candidate → pending_render  │
│ manual_review → needs human        │
│ still_unknown → retry later        │
└─────────────────────────────────────┘
```

## Användning

```typescript
import { screenUrl, determineTriageOutcome } from './C-htmlGate/C1-preHtmlGate';

// För triage_required sources
const preGateResult = await screenUrl(source.url);
const triageOutcome = determineTriageOutcome(preGateResult);

// Skriv resultat till status
updateSourceStatus(source.id, {
  triageResult: triageOutcome,
  triageRecommendedPath: mapOutcomeToPath(triageOutcome),
  triageReason: preGateResult.reason,
});
```

## Internal Mapping

C1:s PreGateCategorization mappas till TriageResult:

| PreGateCategorization | TriageResult |
|------------------------|--------------|
| `strong`, `medium` | `html_candidate` |
| `likelyJsRendered=true` | `render_candidate` |
| `weak`, `noise`, `no-main` | `manual_review` |
| `unfetchable` | `still_unknown` |
