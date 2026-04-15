## Källrapport: varmland

| Fält | Värde |
|------|-------|
| batchId | batch-012 |
| roundNumber | 1 (baseline) |
| sourceId | varmland |
| url | https://varmland.se/ |
| winningStage | C2 |
| outcomeType | fail |
| routeSuggestion | Fail |
| failType | extraction_failure |
| evidence | C3: extraction returned 0 events despite C2 promising (score=34) |
| c0Candidates | 1 |
| winnerUrl | https://varmland.se/start |
| c2Verdict | promising |
| c2Score | 34 |
| eventsFound | 0 |
| changeApplied | none (baseline) |
| improvedAfterChange | n/a |
| rootCause | C2/C3-glapp-fail: JS-renderad SiteVision-sajt, C2 ser strukturer som inte finns i rå-HTML |
| finalDecision | postTestC-Fail-batch012 |