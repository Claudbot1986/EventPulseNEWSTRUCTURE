# C-htmlGate Batch Measurement

**Document Type: PLANERAD DOKUMENTATION**
**Status: DOKUMENTERAD MEN INAKTIV**

> **VAD DETTA ÄR:** Definierar mätfält för att göra C-batchar mätbara över tid.
> **VAD DETTA INTE ÄR:** Används ej aktivt — förbättringsloopen kördes aldrig.
>
> **Bakgrund:** `cyclesCompleted=0` visar att inga mätningar faktiskt genomförts.

Gör C-batchar mätbara och möjliga att utvärdera vetenskapligt över 100–200 batchar. Definierar tydliga fält för att avgöra om en förbättringscykel gav verklig förbättring och när en batch har nått plateau.

## Sökvägar

- Batch-state: `02-Ingestion/C-htmlGate/reports/batch-state.jsonl`
- Batch-summary: `02-Ingestion/C-htmlGate/reports/batch-XXX/batch-XXX-summary.jsonl`

## Mätfält per cykel

### cycleMeasurement

Populeras efter varje förbättringscykel:

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `cycleNumber` | integer | Cykelnummer (1, 2, 3) |
| `sourcesImprovedCount` | integer | Antal sources där post-run events > pre-run events |
| `sourcesRegressedCount` | integer | Antal sources där post-run events < pre-run events |
| `eventsDelta` | integer | postRunEventsTotal - preRunEventsTotal |
| `successDelta` | integer | postRunSuccessCount - preRunSuccessCount |
| `likelyGeneralizationScore` | string | low=<1 site improved, medium=1-2 sites, high=3+ (cross-site evidence) |
| `siteSpecificRisk` | string | none/low/medium/high — är ändringen generell eller hack? |
| `changeCost` | string | small/medium/high — hur stor är kodförändringen? |
| `plateauCandidate` | boolean | true om 2+ zero-improvement cycles ELLER generalization declining |
| `plateauReason` | string? | Specifik anledning om plateauCandidate=true |
| `appliedImprovements` | string[] | IMP-IDs från improvements-bank som applicerades i denna cykel |
| `newImprovementsProposed` | string[] | Nya IMP-IDs som föreslås baserat på denna cykel |

### cycleHistory

Array med alla tidigare cycleMeasurement-objekt. Möjliggör trendanalys.

### plateauDecision

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `plateauReached` | boolean | Är plateau nu nått? |
| `plateauReason` | string? | Varför plateau |
| `consecutiveZeroImprovementCycles` | integer | Antal cykler i rad med sourcesImprovedCount=0 |
| `recommendation` | string | continue/stop/investigate |
| `stopCriteriaMet` | string? | Vilket stoppkriterium uppfylldes |

## Plateau-regler

| RuleID | Villkor | Implikation | Anledning |
|--------|---------|-------------|-----------|
| PLATEAU-001 | sourcesImprovedCount = 0 i 2+ cykler | plateauCandidate = true | Ingen mätbar förbättring trots ändringar |
| PLATEAU-002 | eventsDelta = 0 i 2+ cykler efter initial framgång | plateauCandidate = true | Minskande avkastning på event-extraction |
| PLATEAU-003 | likelyGeneralizationScore sjunker över 2+ cykler | plateauCandidate = true | Ändringar blir mer site-specifika |
| PLATEAU-004 | siteSpecificRisk ökar till "high" | STOPP omedelbart | Ackumulerade hacks signalerar fel riktning |

## Hur plateau avgörs

### Steg 1: Efter varje cykel, beräkna:
```
sourcesImprovedCount = antal sources med eventsDelta > 0
sourcesRegressedCount = antal sources med eventsDelta < 0
```

### Steg 2: Utvärdera mot plateau-regler:
```
IF sourcesImprovedCount == 0 FOR 2+ cycles:
    plateauCandidate = true
    plateauReason = "no-sources-improved"

IF siteSpecificRisk == "high":
    STOP immediately
    do-not-implement
```

### Steg 3: Gör trendanalys via cycleHistory:
```
# Är generaliseringen ökande eller minskande?
if cycleHistory[-2].likelyGeneralizationScore > cycleHistory[-1].likelyGeneralizationScore:
    # Generalization declining
```

## Analysfrågor

### Gav ändringen verklig förbättring?
```bash
# Sök efter cycles med sourcesImprovedCount > 0
grep '"sourcesImprovedCount": [1-9]' batch-state.jsonl
```

### Förbättrade den fler än en källa?
```bash
# Visa alla cycles med multi-site improvement
grep '"sourcesImprovedCount": [2-9]' batch-state.jsonl
```

### Blev modellen mer generell eller mer specialhackad?
```bash
# Visa generalization score trend
grep '"likelyGeneralizationScore"' batch-state.jsonl
```

### När ska batchen stoppas?
```bash
# Visa plateau decisions
grep '"plateauReached": true' batch-state.jsonl
```

## Exempel: Typisk cykelhistorik

### Batch-010 med 2 cykler

**Cykel 1 (initial):**
```json
{
  "cycleNumber": 1,
  "sourcesImprovedCount": 2,
  "sourcesRegressedCount": 0,
  "eventsDelta": 15,
  "successDelta": 0,
  "likelyGeneralizationScore": "low",
  "siteSpecificRisk": "low",
  "changeCost": "small",
  "plateauCandidate": false,
  "appliedImprovements": ["IMP-005"],
  "newImprovementsProposed": ["IMP-009"]
}
```

**Cykel 2 (efter IMP-009 applicerades):**
```json
{
  "cycleNumber": 2,
  "sourcesImprovedCount": 5,
  "sourcesRegressedCount": 0,
  "eventsDelta": 42,
  "successDelta": 1,
  "likelyGeneralizationScore": "high",
  "siteSpecificRisk": "none",
  "changeCost": "medium",
  "plateauCandidate": false,
  "appliedImprovements": ["IMP-005", "IMP-009"],
  "newImprovementsProposed": []
}
```

**Resultat:**
- sourcesImprovedCount ökade från 2 till 5
- likelyGeneralizationScore ökade från "low" till "high"
- plateauDecision: plateauReached=false, recommendation=continue
