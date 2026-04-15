## Round Report round-1 (batch-14)

> **LEARNING LOOP PROOF** — Round 1 av 1 (batch-14)
> Verify att lärloopen producerar konkret återkoppling, inte bara analys.

### LEARNING LOOP PROOF — Per Source

| sourceId | failCategory | ruleSaved | ruleApplied | routedTo | refillBlocked | outcomeChanged |
|----------|-------------|-----------|-------------|----------|---------------|----------------|
| mittuniversitetet | NEEDS_SUBPAGE_DISCOVERY | **yes** (conf=0.65) | **yes** (→postTestC-B) | B | no | **yes** |
| kungsbacka | NEEDS_SUBPAGE_DISCOVERY | **yes** (conf=0.70) | **yes** (→postTestC-B) | B | no | **yes** |
| h-gskolan-i-sk-vde | NEEDS_SUBPAGE_DISCOVERY | **yes** (conf=0.65) | **yes** (→postTestC-B) | B | no | **yes** |
| malm-opera | NEEDS_SUBPAGE_DISCOVERY | **yes** (conf=0.60) | **yes** (→postTestC-B) | B | no | **yes** |
| svenska-innebandyf-rbundet | LIKELY_JS_RENDER | **yes** (conf=0.60) | **yes** (→postTestC-D) | D | no | **yes** |
| naturhistoriska-riksmuseet | UNKNOWN | no (cat not eligible) | no (UNKNOWN not in eligible cats) | B | no | **analysis-only** |
| ois | LOW_VALUE_SOURCE | no (conf=0.55 < 0.6) | no (conf too low) | B | no | **analysis-only** |
| malmo-hogskola | LIKELY_JS_RENDER | no (conf=0.60 < 0.85) | no (JS conf < 0.85 threshold) | D | no | **analysis-only** |
| ralambshovsparken | LIKELY_JS_RENDER | no (conf=0.60 < 0.85) | no (JS conf < 0.85 threshold) | D | no | **analysis-only** |
| hammarkullen | (route_success, not fail) | n/a | n/a | D | no | no (normal C1 exit) |

### LEARNING LOOP PROOF — Summary

|| Metric | Value ||
||--------|-------||
| sourcesAnalyzed | 9 ||
| rulesSaved | 6 (conf ≥ 0.6 + eligible category) ||
| rulesApplied | 5 (6th — svenska-innebandyf-rbundet: saved but routed to D, not pool retry) ||
| analysisOnly | 4 (category not eligible OR conf below threshold) ||
| refillBlocked | 0 (no source met LIKELY_JS_RENDER ≥ 0.85 threshold) ||
| confirmedOutcomeChange | 5 (routed to B/D in round 1 vs. would have stayed in pool for round 2) ||
| noChange | 1 (hammarkullen — normal C1 exit, not C4-driven) ||
| nextRoundNeeded | pool empty — no refill possible after C4 routing emptied pool ||

### Analysis-Only Sources (no derived rule applied)

| sourceId | reasonNoRule | whatHappened |
|----------|-------------|--------------|
| naturhistoriska-riksmuseet | UNKNOWN not in eligible categories | C4 routed → B, no rule persisted |
| ois | LOW_VALUE_SOURCE, conf 0.55 < 0.6 threshold | C4 routed → B, below save threshold |
| malmo-hogskola | LIKELY_JS_RENDER, conf 0.60 < 0.85 threshold | C4 routed → D, below PROMPT-5 auto-D threshold |
| ralambshovsparken | LIKELY_JS_RENDER, conf 0.60 < 0.85 threshold | C4 routed → D, below PROMPT-5 auto-D threshold |

### LEARNING LOOP VERDICT

**loop_type:** partial — analysis happened, rules saved, routing changed, but pool exhausted before next-round verification
**blocked_refill_count:** 0
**saved_rules_count:** 6
**applied_rules_count:** 5
**unmatched_analysis_count:** 4
**verdict:** "analysis only" for 4 sources where conf below threshold or category not eligible. Confirmed routing change for 5 sources. No refill blocked (PROMPT-5 threshold not met in this batch).
**recommended_next_step:** Run batch-15 with fresh pool to verify derived rules from batch-14 are loaded and applied before C4 analysis

---

|| Field | Value ||
||-------|-------|
| batchId | batch-14 |
| roundNumber | 1 |
| inputQueue | postB-preC |
| sourcesIn | 10 |
| extractSuccess | 0 |
| routeSuccess | 1 |
| fail | 9 |
| totalEvents | 0 |

### Sources that failed (stay in pool for next round)
- naturhistoriska-riksmuseet
- mittuniversitetet
- ois
- kungsbacka
- h-gskolan-i-sk-vde
- svenska-innebandyf-rbundet
- malmo-hogskola
- ralambshovsparken
- malm-opera

### Sources that exited
- hammarkullen: postTestC-D