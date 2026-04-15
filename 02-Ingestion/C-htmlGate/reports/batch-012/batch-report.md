## Batchrapport batch-012

|| Fält | Värde |
|------|-------|
| batchId | batch-012 |
| roundNumber | 1 (baseline) |
| inputQueue | postTestC-Fail-batch012 |
| sourcesIn | 10 |
| extractSuccess | 0 |
| routeSuccess | 0 |
| fail | 10 |
| totalEventsExtracted | 0 |

### failTypeDistribution
- extraction_failure: 2 (varmland, liseberg-n-je)
- screening_failure: 1 (svenska-hockeyligan-shl)
- discovery_failure: 3 (brommapojkarna, nykoping, medeltidsmuseet)
- network_failure: 3 (ik-sirius, helsingborg-arena, kth, g-teborgs-posten — blandade: DNS, timeout, 404, cert)
- canonical_source_data_failure: 2 (kth, g-teborgs-posten — HTTP 404)

### winningStageDistribution
- C1: 0
- C2: 0
- C3: 0

### generalChangesTested
- (ingen ändring i baseline-runda 1)

### beforeSummary
Baseline batch-012: 0/10 extract_success, 0/10 route_success, 10/10 fail, 0 events

### afterSummary
Samma som baseline — ingen ändring ännu

### stopReason
baseline_only — round 1 klar, förbättringsloop pågår

### nextStep
Kör 123-runda-1 på postTestC-Fail-batch012

### keyPatternObserved
**varmland och liseberg är JS-renderade sajter (SiteVision/AppRegistry) men C1.detekterar dem som icke-JS.** C2=promising beror på att sidan mäter HTML-struktur som inte finns i rå-HTML. Dessa källor behöver D-renderGate.
