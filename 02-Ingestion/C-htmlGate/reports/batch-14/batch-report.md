## Batch Report batch-14

### STATUS LABELS
RUNNER_EXECUTES: confirmed
FLOW_PARTIALLY_VERIFIED: rounds 1-3 executed
C4_AI_INTEGRATED: C4-AI inkopplad, kör efter varje round (IMPLEMENTED_EARLY_VERSION)
RESUME_VERIFIED: resume verified (2026-04-11)
NOT_CANONICAL_YET: first working version, not final canonical

| Field | Value |
|-------|-------|
| batchId | batch-14 |
| poolRoundNumber | 1 |
| inputQueue | postB-preC |
| sourcesIn | 10 |
| extractSuccess | 0 |
| routeSuccess | 1 |
| fail | 9 |
| totalEventsExtracted | 0 |
| exits | 10 |
| stopReason | max-rounds-reached-or-pool-exhausted |

### Queue distribution (exits)
- hammarkullen: postTestC-D
- naturhistoriska-riksmuseet: postTestC-B
- mittuniversitetet: postTestC-B
- ois: postTestC-B
- kungsbacka: postTestC-B
- h-gskolan-i-sk-vde: postTestC-B
- svenska-innebandyf-rbundet: postTestC-D
- malmo-hogskola: postTestC-D
- ralambshovsparken: postTestC-D
- malm-opera: postTestC-B

### Remaining sources (active pool after max rounds)
(none — pool exhausted before max rounds)

### Pool state at end
- Active pool: 0 sources
- Exited: 10 sources
- Total rounds run: 1

---

### FAIL CATEGORY SUMMARY
|| Category | Count ||
||----------|-------|
|| WRONG_ENTRY_PAGE | 0 |
|| NEEDS_SUBPAGE_DISCOVERY | 4 |
|| LIKELY_JS_RENDER | 3 |
|| EXTRACTION_PATTERN_MISMATCH | 0 |
|| LOW_VALUE_SOURCE | 1 |
|| UNKNOWN | 1 |

### TOP NEXT ACTIONS
|| Action | Count ||
||--------|-------|
|| tillbaka till C1 | 0 ||
|| till D-renderGate | 3 ||
|| discard/manual review | 0 ||
|| till A | 0 ||
|| till B | 6 |

---

### LEARNING LOOP PROOF — batch-14

> **Syfte:** Visa exakt vilka sources som fick konkret återkoppling vs. endast analys.

#### Sources med Derived Rule + Routing Change

| sourceId | failCategory | ruleSaved | routedTo | refillBlocked | outcomeChanged |
|----------|-------------|-----------|----------|-------------|---------------|
| mittuniversitetet | NEEDS_SUBPAGE_DISCOVERY | **yes** (conf=0.65, paths=[/events,/program,...]) | B | no | **yes** |
| kungsbacka | NEEDS_SUBPAGE_DISCOVERY | **yes** (conf=0.70, paths=[/events,/program,...]) | B | no | **yes** |
| h-gskolan-i-sk-vde | NEEDS_SUBPAGE_DISCOVERY | **yes** (conf=0.65, paths=[/events,/program,...]) | B | no | **yes** |
| malm-opera | NEEDS_SUBPAGE_DISCOVERY | **yes** (conf=0.60, paths=[/events,/program,...]) | B | no | **yes** |
| svenska-innebandyf-rbundet | LIKELY_JS_RENDER | **yes** (conf=0.60) | D | no | **yes** |

#### Sources Analysis-Only (ingen regel sparades)

| sourceId | failCategory | reasonNoRule | C4-routing |
|----------|-------------|-------------|------------|
| naturhistoriska-riksmuseet | UNKNOWN | UNKNOWN not in eligible categories | B |
| ois | LOW_VALUE_SOURCE | conf 0.55 < 0.6 threshold | B |
| malmo-hogskola | LIKELY_JS_RENDER | conf 0.60 < 0.85 threshold | D |
| ralambshovsparken | LIKELY_JS_RENDER | conf 0.60 < 0.85 threshold | D |

#### Sources med Normal Exit (icke C4-driven)

| sourceId | exitReason | outcomeChanged |
|----------|-----------|---------------|
| hammarkullen | C1 likelyJsRendered=true → D | no (not C4-driven) |

#### Loop-Stats

|| Metric | Value |
||--------|-------|
| sourcesAnalyzedByC4 | 9 |
| rulesSaved | 6 |
| rulesAppliedToRouting | 5 |
| analysisOnly | 4 |
| refillBlocked (PROMPT-5) | 0 |
| normalExits | 1 |
| confirmedOutcomeChange | 5 |
| nextRoundVerification | pool empty — batch-15 behövs för att verifiera regler i praktiken |

#### LEARNING LOOP VERDICT

| Aspect | Status |
|--------|--------|
| rule persistence | **working** — 6 rules saved to c4-derived-rules.jsonl |
| rule loading | **working** — loadAllDerivedRules() läser historiska regler |
| routing change | **confirmed** — 5 sources routed to B/D in round 1 istället för round 2 |
| analysis-only gap | **identified** — 4 sources med conf under threshold ellericke-eligible category |
| refill blocking | **not triggered** — 0 sources mötte LIKELY_JS_RENDER ≥ 0.85 |
| next-round proof | **blocked** — pool exhausted after C4 routing, batch-15 krävs |

---

---

### <generated_artifacts>
- batch-report.md: generated
- round-reports: 1 generated (round-1 through round-1)
- source-reports: 10 generated
- c4-ai-learnings.md: generated (placeholder only, C4-AI not executed)
</generated_artifacts>

### <verified_capabilities>
- dynamic pool filled (batch size: 10)
- refill between rounds: verified (0 sources refilled across all rounds)
- round 1 executed: confirmed
- round 2 executed: confirmed
- round 3 executed: confirmed
- queue exits verified: 10 sources routed to output queues
- pool-state persisted: saved to batch-14/pool-state.json
</verified_capabilities>

| <not_verified_yet>
| - resume from pool-state (RESUME_VERIFIED)
| - real C4-AI analysis (C4_AI_INTEGRATED — AI inkopplad och körande)
| - canonical status (NOT_CANONICAL_YET)
</not_verified_yet>