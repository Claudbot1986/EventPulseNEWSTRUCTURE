# C-htmlGate Improvements Bank

## Syfte

Strukturerad förteckning över generella HTML-scraping-förbättringar som C-batchar kan referera till och återanvända. Banken är utformad för att vara spårbar över 100–200 batchar utan att bli stor eller ostrukturerad.

## Sökväg

`02-Ingestion/C-htmlGate/reports/improvements-bank.jsonl`

## Format

En JSON-rad (JSONL) per förbättring. Varje rad innehåller:

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `stableId` | string | Permanent ID (t.ex. IMP-001) |
| `name` | string | Kort maskinläsbart namn |
| `description` | string | Vad förbättringen gör |
| `problemType` | string | Kategori: date_extraction, structure_detection, routing, discovery, pipeline_bug |
| `affectedPatterns` | string[] | Vilka sidmönster den hjälper |
| `supportedByBatches` | string[] | Vilka batchar som stödjer/triggar denna |
| `generalizable` | boolean | Är mönstret generaliserbart till flera domäner? |
| `siteSpecificRisk` | string | none/low/medium/high |
| `status` | string | proposed/tested/useful/weak/rejected |
| `createdAt` | string | ISO timestamp (staggered 5s mellan poster för enkel sortering) |
| `lastValidatedAt` | string? | ISO timestamp när förbättringen senast validerades (null för proposed) |
| `evidenceType` | string | Hur förbättringen upptäcktes: batch-report, source-report, manual-analysis, code-fix, mixed |
| `notes` | string | Strukturerad text med observation/risk/nextStep |

## Fältet `notes` - Strukturerat format

`notes` ska vara kort och strukturerad med tre delar:

```
observation: [vad vi observerade]
risk: [vilken risk finns det med denna förbättring]
nextStep: [vad behöver göras för att validera/förbättra]
```

Exempel:
```
observation: anchor+date pairs often in sibling/parent text nodes on text-adjacent-to-link patterns; risk: nearby text may be navigation text, not event date; nextStep: validate on 5 sites with text-adjacent dates
```

För poster med inga anteckningar lämnas `notes` som tom sträng (`""`).

## Fältet `evidenceType` - Typer

| Värde | Betydelse |
|-------|-----------|
| `batch-report` | Upptäcktes via analys av batch-rapport |
| `source-report` | Upptäcktes via analys av enskild källrapport |
| `manual-analysis` | Upptäcktes genom manuell kodanalys |
| `code-fix` | Förbättringen var en buggfix i befintlig kod |
| `mixed` | Kombination av flera ovan |

## Fältet `lastValidatedAt`

- Sätts när status är `tested` eller `useful`
- Lämnas som `null` för `proposed`
- Uppdateras varje gång förbättringen valideras igen

## Status-livscykel

```
proposed → tested → useful
                ↘ weak
                ↘ rejected
```

### Uppgradera en post

För att uppgradera en post från proposed till tested:

1. Sätt `status` till `tested`
2. Sätt `lastValidatedAt` till aktuell timestamp
3. Lägg till `supportedByBatches` med batch-ID

Exempel - IMP-009 uppgraderas efter batch-011:

```json
{
  "stableId": "IMP-009",
  "name": "new_improvement",
  "status": "tested",
  "lastValidatedAt": "2026-04-07T14:30:00.000Z",
  "supportedByBatches": ["batch-011"],
  "evidenceType": "batch-report",
  "notes": "observation: ...; risk: ...; nextStep: ..."
}
```

## Lägga till ny förbättring

```bash
echo '{"stableId":"IMP-009","name":"...","status":"proposed","evidenceType":"manual-analysis","lastValidatedAt":null,"createdAt":"2026-04-07T10:00:00.000Z","notes":""}' >> 02-Ingestion/C-htmlGate/reports/improvements-bank.jsonl
```

## Referera från batch-rapport

I batch-rapport, lägg till:

```json
{
  "appliedImprovements": ["IMP-001", "IMP-005"],
  "newImprovementsProposed": ["IMP-009"]
}
```

## Läsa banken

```bash
# Visa alla
cat improvements-bank.jsonl

# Filtrera på status
grep '"status":"tested"' improvements-bank.jsonl

# Sök efter specifik typ
grep '"problemType":"date_extraction"' improvements-bank.jsonl

# Visa alla med evidenceType
grep -o '"evidenceType":"[^"]*"' improvements-bank.jsonl | sort | uniq -c
```

## Analysfrågor som fälten möjliggör

### Hur många förbättringar kom från respektive evidens-typ?
```bash
grep -o '"evidenceType":"[^"]*"' improvements-bank.jsonl | sort | uniq -c
```

### Vilka förbättringar har inte validerats på länge (>30 dagar)?
```bash
# Filtrera på lastValidatedAt äldre än 2026-03-07
grep '"lastValidatedAt":"2026-03' improvements-bank.jsonl
```

### Vilka proposed-förbättringar har högst generalizerbarhet?
```bash
grep '"status":"proposed".*"generalizable":true' improvements-bank.jsonl
```
