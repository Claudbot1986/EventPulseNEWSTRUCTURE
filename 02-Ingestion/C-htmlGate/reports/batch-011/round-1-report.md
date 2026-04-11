## Rundrapport round-1 (batch-011)

| Fält | Värde |
|------|-------|
| batchId | batch-011 |
| roundNumber | 1 |
| failSetUsed | runtime/postTestC-Fail-round1.jsonl |

### hypothesis
C0 hittar för få candidates. När C0 hittar 0 candidates, ge upp helt (winner=undefined). Men root URL mäts redan. Om root har events borde den kunna användas som fallback.

### changeApplied
Root URL fallback i C0: När `candidates.length === 0` OCH `rootDensityScore > 0`, använd root URL som winner istället för null.

### whyGeneral
Samma mönster påverkar 7+ sajter: root URL fungerar men inga interna candidates hittas. Ändringen är generell — ingen site-specifik logik.

### beforeResults
```json
{
  "extractSuccess": 0,
  "routeSuccess": 0,
  "fail": 10,
  "totalEvents": 0,
  "failTypeDistribution": {
    "C0-discovery-fail": 7,
    "C2/C3-glapp-fail": 3
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
    "C0-discovery-fail": 7,
    "C2/C3-glapp-fail": 3
  }
}
```

### sourcesImproved
[]

### sourcesUnchanged
["varmland", "svenska-hockeyligan-shl", "nykoping", "liseberg-n-je", "medeltidsmuseet", "ik-sirius", "kth", "helsingborg-arena", "g-teborgs-posten", "brommapojkarna"]

### sourcesWorsened
[]

### decision
revert

### runNextRound
false

### stopReason
no-general-improvement — root URL fallback hjälpte inte eftersom problemet ligger i C3 (extraktion), inte C0 (discovery).

### learnedRule
Root URL fallback i C0 hjälper inte när grundproblemet är C3-extraction eller nätverksfel (timeout, 404, DNS).
