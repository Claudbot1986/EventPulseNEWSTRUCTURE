## Batchrapport batch-011

| Fält | Värde |
|------|-------|
| batchId | batch-011 |
| roundNumber | 1 |
| inputQueue | postB-preC |
| sourcesIn | 10 |
| extractSuccess | 0 |
| routeSuccess | 0 |
| fail | 10 |
| totalEventsExtracted | 0 |

### failTypeDistribution
- C0-discovery-fail: 7
- C2/C3-glapp-fail: 3

### winningStageDistribution
- C1: 0
- C2: 0
- C3: 0
- C4-AI: 0

### generalChangesTested
- Round 1: Root URL fallback i C0 (REVERTED — ingen förbättring)

### beforeSummary
Baseline batch-011: 0/10 extract_success, 0/10 route_success, 10/10 fail, 0 events

### afterSummary
Round 1 re-run: 0/10 extract_success, 0/10 route_success, 10/10 fail, 0 events — ingen förbättring

### stopReason
no-general-improvement — Root URL fallback i C0 hjälpte inte. Problemet är C3-extraction för varmland/liseberg (C2=promising men C3=0), och nätverksfel för övriga (DNS, timeout, 404, cert).

### nextStep
Fokusera på C3-förbättring för varmland/liseberg i nästa runda. De övriga 7 har nätverksfel som kräver andra verktyg (D-render, network inspection) eller är kandidater för A/B-spåret.
