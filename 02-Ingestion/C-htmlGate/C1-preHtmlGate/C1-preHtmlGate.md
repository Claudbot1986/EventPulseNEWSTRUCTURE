# C1-preHtmlGate — Triage Tool

## CANONICAL NAMNING — RELATION TILL C0

**C1 i nuvarande implementation och C1 i canonical målmodell är Samma ting, olika namn.**

Den nuvarande koden har:
- **C0** (`C0-htmlFrontierDiscovery/`) — hittar interna links, mäter event-density, väljer bästa candidate
- **C1** (`C1-preHtmlGate/`) — screening via fetch + DOM-analys

**Canonical målmodell** börjar vid C1 (Discovery/Frontier), utan C0 före sig.

Det betyder:
- **Nuvarande C0 ≈ Canonical C1** (båda gör discovery/frontier)
- **Nuvarande C1 = Canonical C1** (samma funktion)
- **Nuvarande C2 = Canonical C2** (HTML-screening)
- **extractFromHtml() = Canonical C3** (HTML-extraktion)
- **C3-aiExtractGate = Canonical C4-AI** (AI-fallback)

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
