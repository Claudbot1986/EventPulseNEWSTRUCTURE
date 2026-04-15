## Round Report round-1 (batch-13)

| Field | Value |
|-------|-------|
| batchId | batch-13 |
| roundNumber | 1 |
| inputQueue | postB-preC |
| sourcesIn | 8 |
| extractSuccess | 0 |
| routeSuccess | 0 |
| fail | 8 |
| totalEvents | 0 |

### Sources that failed (stay in pool for next round)
- konserthuset
- tradgardsforeningen
- vasteras-konstmuseum
- uppsala-basket
- stenungsund
- gr-na-lund
- tekniska-museet
- junibacken
- bk-hacken
- blekholmen

### LEARNING LOOP PROOF (round-1)

### Syfte
Visa lärandet från round-1-specifika beslut.

### round-1 FAIL-SET TRACKING

| sourceId | failCategory | ruleCreated | ruleApplied | nextAction | outcomeChanged |
|----------|--------------|-------------|-------------|------------|----------------|
| konserthuset | extraction_failure | no | no | retry-pool | NO |
| tradgardsforeningen | discovery_failure | no | no | retry-pool | NO |
| vasteras-konstmuseum | discovery_failure | no | no | retry-pool | NO |
| uppsala-basket | screening_failure | no | no | retry-pool | NO |
| stenungsund | discovery_failure | no | no | retry-pool | NO |
| gr-na-lund | screening_failure | no | no | retry-pool | NO |
| tekniska-museet | discovery_failure | no | no | retry-pool | NO |
| junibacken | discovery_failure | no | no | retry-pool | NO |
| bk-hacken | NEEDS_SUBPAGE_DISCOVERY | no | yes (persisted) | retry-pool | NO |
| blekholmen | NEEDS_SUBPAGE_DISCOVERY | no | yes (persisted) | retry-pool | NO |

### round-1 LEARNING SCORE

| Metric | Value |
|--------|-------|
| Total fail sources | 10 |
| Sources med regel skapad | 0 |
| Sources där outcome ändrades | 0 |
| **Learning rate** | **0% (0/10)** |

### round-1 OBSERVATION
Inga regler skapades i round-1. Alla 10 sources behölls i poolen för round-2.
Inga fail-patterner identifierades som generella nog för regel-sparning.

---

## Sources that exited

- mobilia → postTestC-D (LIKELY_JS_RENDER, outcomeChanged=YES, route_success)
- oceanen → postTestC-D (LIKELY_JS_RENDER, outcomeChanged=YES, route_success)