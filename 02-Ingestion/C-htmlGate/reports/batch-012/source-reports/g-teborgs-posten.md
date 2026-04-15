## Källrapport: g-teborgs-posten

|| Fält | Värde |
|------|-------|
| batchId | batch-012 |
| roundNumber | 1 |
| sourceId | g-teborgs-posten |
| url | https://gp.se/evenemang |
| winningStage | C3 |
| outcomeType | fail |
| routeSuggestion | Fail |
| failType | canonical_source_data_failure |
| networkFailureSubType | http_404_problem |
| networkErrorDiagnosis | HTTP 404 på /evenemang-sidan. Göteborgs-Posten har sannolikt ändrat sin URL-struktur för evenemang. Evenemangssidan finns kanske på annan path (t.ex. /kultur/, /event/ eller liknande). |
| networkErrorConfidence | high |
| evidence | C0: 0 candidates, HTTP 404 |
| c0Candidates | 0 |
| winnerUrl | null |
| c2Verdict | unclear |
| c2Score | 0 |
| eventsFound | 0 |
| changeApplied | null |
| improvedAfterChange | N/A |
| rootCause | canonical_source_data_failure: http_404_problem — canonical URL är felaktig |
| finalDecision | postTestC-Fail-batch012-round2 |
