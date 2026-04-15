## Källrapport: liseberg-n-je

| Fält | Värde |
|------|-------|
| batchId | batch-012 |
| roundNumber | 1 |
| sourceId | liseberg-n-je |
| url | https://liseberg.se/ |
| winningStage | C3 |
| outcomeType | fail |
| routeSuggestion | Fail |
| failType | C2/C3-glapp-fail |
| evidence | C3: extraction returned 0 events despite C2 promising (score=187) |
| c0Candidates | 10 |
| winnerUrl | https://liseberg.se/parken/evenemang/ |
| c2Verdict | promising |
| c2Score | 187 |
| eventsFound | 0 |
| changeApplied | ingen |
| improvedAfterChange | oförändrat |
| rootCause | C2/C3-glapp-fail: C2=promising (187) men C3 hittade 0 events – C3 är JSON-LD only och lisebergs JSON-LD använder @type=Place istället för Event |
| finalDecision | postTestC-Fail-round2 |
