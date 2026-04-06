# C-htmlGate Improvements Bank

## Syfte

Strukturerad förteckning över generella HTML-scraping-förbättringar som C-batchar kan referera till och återanvända.

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
| `createdAt` | string | ISO timestamp |
| `notes` | string | Ytterligare kommentarer |

## Lägga till ny förbättring

```bash
echo '{"stableId":"IMP-009","name":"...","status":"proposed",...}' >> 02-Ingestion/C-htmlGate/reports/improvements-bank.jsonl
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
```
