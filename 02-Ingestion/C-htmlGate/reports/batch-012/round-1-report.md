## Rundrapport round-1 (batch-012)

|| Fält | Värde |
|------|-------|
| batchId | batch-012 |
| roundNumber | 1 |
| failSetUsed | runtime/postTestC-Fail-batch012-round1.jsonl |

### hypothesis
C3 (extractFromHtml) saknar ISO-datum (YYYY-MM-DD) extrahering. Lägga till isoDateRegex för att hämta events från HTML-text med ISO-datum.

### changeApplied
Lade till isoDateRegex och extractIsoDateFromText() i extractFromHtml() för att fånga ISO-datum mönster (YYYY-MM-DD) i HTML-text.

### whyGeneral
ISO-datum är standardformat och kan förekomma på många sajter. Ändringen är generell, inte sitespecifik.

### beforeResults
```json
{
  "extractSuccess": 0,
  "routeSuccess": 0,
  "fail": 10,
  "totalEvents": 0,
  "failTypeDistribution": {
    "extraction_failure": 2,
    "screening_failure": 1,
    "discovery_failure": 3,
    "network_failure": 3,
    "canonical_source_data_failure": 2
  }
}
```

### afterResults
```json
{
  "extractSuccess": 0,
  "routeSuccess": 0,
  "fail": 10,
  "totalEvents": 0,
  "failTypeDistribution": {
    "extraction_failure": 2,
    "screening_failure": 1,
    "discovery_failure": 3,
    "network_failure": 3,
    "canonical_source_data_failure": 2
  }
}
```

### sourcesImproved
[]

### sourcesUnchanged
["brommapojkarna", "varmland", "svenska-hockeyligan-shl", "nykoping", "liseberg-n-je", "medeltidsmuseet", "ik-sirius", "kth", "helsingborg-arena", "g-teborgs-posten"]

### sourcesWorsened
[]

### decision
revert

### runNextRound
false

### stopReason
no-general-improvement — ISO-datum ändringen hjälpte inte dessa källor. varmland och liseberg är JavaScript-renderade sajter (SiteVision/AppRegistry) där datum finns i JS-kod, inte synlig HTML-text.

### learnedRule
ISO-datum extraktion i HTML-text hjälper inte när datumen finns i JavaScript-kod (JS-renderade sajter). För varmland och liseberg behövs D-renderGate istället för HTML-extraction.
