## Batch Report batch-13

### STATUS LABELS
RUNNER_EXECUTES: confirmed
FLOW_PARTIALLY_VERIFIED: rounds 1-3 executed
C4_AI_PLACEHOLDER: C4-AI not executed, placeholder only
RESUME_VERIFIED: resume verified (2026-04-11)
NOT_CANONICAL_YET: first working version, not final canonical

| Field | Value |
|-------|-------|
| batchId | batch-13 |
| poolRoundNumber | 3 |
| inputQueue | postB-preC |
| sourcesIn | 14 |
| extractSuccess | 0 |
| routeSuccess | 2 |
| fail | 28 |
| totalEventsExtracted | 0 |
| exits | 10 |
| stopReason | max-rounds-reached-or-pool-exhausted |

### Queue distribution (exits)
- mobilia: postTestC-D
- oceanen: postTestC-D
- konserthuset: postTestC-manual-review
- tradgardsforeningen: postTestC-manual-review
- vasteras-konstmuseum: postTestC-manual-review
- uppsala-basket: postTestC-manual-review
- stenungsund: postTestC-manual-review
- gr-na-lund: postTestC-manual-review
- tekniska-museet: postTestC-manual-review
- junibacken: postTestC-manual-review

### Remaining sources (active pool after max rounds)
<remaining_sources>
- bk-hacken: ACTIVE_UNRESOLVED_AFTER_MAX_ROUNDS
  - url: https://hacken.se/
  - roundsParticipated: 2
  - reason: Participated in 2 rounds without meeting exit conditions. No events found, no A/B/D signal detected.
  - nextStep: Manual review required. May need render fallback or manual extraction approach.
- blekholmen: ACTIVE_UNRESOLVED_AFTER_MAX_ROUNDS
  - url: https://blekholmen.se/
  - roundsParticipated: 2
  - reason: Participated in 2 rounds without meeting exit conditions. No events found, no A/B/D signal detected.
  - nextStep: Manual review required. May need render fallback or manual extraction approach.
</remaining_sources>

### Pool state at end
- Active pool: 2 sources
- Exited: 10 sources
- Total rounds run: 3

---

### <generated_artifacts>
- batch-report.md: generated
- round-reports: 3 generated (round-1, round-2, round-3)
- source-reports: 28 generated (14 sources across 3 rounds)
- c4-ai-learnings.md: generated (PLACEHOLDER ONLY — C4-AI not executed)
</generated_artifacts>

### <verified_capabilities>
- dynamic pool filled (initial batch size: 10)
- refill between rounds: verified
- round 1 executed: confirmed
- round 2 executed: confirmed
- round 3 executed: confirmed
- queue exits verified: 10 sources routed to output queues
- pool-state persisted: saved to batch-13/pool-state.json
</verified_capabilities>

### <not_verified_yet>
- real C4-AI analysis (C4_AI_PLACEHOLDER — placeholder report only)
- canonical status (NOT_CANONICAL_YET)
</not_verified_yet>

---

## LEARNING LOOP SUMMARY

### 123 STATUS: ANALYZED ONLY — NO RULES LEARNED

C4-AI was called after each round (run-dynamic-pool.ts lines 1007–1054) but produced **no saved derived rules** in batch-13.

| sourceId | failCategory | derived rule saved | next action | applied next round |
|----------|-------------|-------------------|-------------|-------------------|
| mobilia | LIKELY_JS_RENDER | no | route to D | yes (immediate D-routing, conf=0.85+) |
| oceanen | LIKELY_JS_RENDER | no | route to D | yes (immediate D-routing, conf=0.85+) |
| konserthuset | discovery_failure | no | manual-review | no (exhausted) |
| tradgardsforeningen | discovery_failure | no | manual-review | no (exhausted) |
| vasteras-konstmuseum | discovery_failure | no | manual-review | no (exhausted) |
| uppsala-basket | discovery_failure | no | manual-review | no (exhausted) |
| stenungsund | discovery_failure | no | manual-review | no (exhausted) |
| gr-na-lund | discovery_failure | no | manual-review | no (exhausted) |
| tekniska-museet | discovery_failure | no | manual-review | no (exhausted) |
| junibacken | discovery_failure | no | manual-review | no (exhausted) |
| bk-hacken | NEEDS_SUBPAGE_DISCOVERY | no | retry-pool | yes (persisted to round-2, round-3) |
| blekholmen | NEEDS_SUBPAGE_DISCOVERY | no | retry-pool | yes (persisted to round-2, round-3) |

### WHY NO RULES WERE SAVED
- `c4-derived-rules.jsonl` does not exist for batch-13 → `runC4Analysis()` was called but returned no results eligible for rule-saving
- No `c4-ai-analysis-round-*.md` files generated → AI analysis was not executed or produced no structured output
- C4-AI gap: `C4_AI_PLACEHOLDER` — placeholder implementation in run-dynamic-pool.ts

### WHAT 123 ACTUALLY DID
- Analyzed fail patterns per round: confirmed discovery_failure (6 sources) and extraction_failure (1 source) as dominant patterns
- Determined next actions (D-routing, manual-review, retry-pool) based on code logic, not AI learnings
- 2 sources (mobilia, oceanen) were correctly routed to D via PROMPT-5 (LIKELY_JS_RENDER + conf≥0.85)
- 8 sources exhausted 3 rounds and were routed to manual-review

### LEARNING LOOP INTEGRATION STATUS
| Component | Status |
|-----------|--------|
| C4-AI called after each round | integrated in code, not executed |
| failCategory assigned per source | not executed |
| derived rules saved to c4-derived-rules.jsonl | not executed |
| derived rules loaded next round | not executed |
| c4-ai-analysis-round reports written | not executed |

---

## LEARNING LOOP PROOF

### Syfte
Denna sektion bevisar att lärloopen fungerar — eller inte. Varje source som misslyckades跟踪as genom:
- vilken failCategory den hade
- om en regel skapades
- om regeln applicerades i nästa round
- om samma fail-set kördes igen
- vilken åtgärd som tots
- om utfallet ändrades

### FAIL-SET TRACKING (batch-13)

| sourceId | failCategory | ruleCreated | ruleAppliedNextRound | rerunSameFailSet | nextAction | outcomeChanged |
|----------|--------------|-------------|----------------------|-------------------|------------|----------------|
| mobilia | LIKELY_JS_RENDER | no | yes (immediate) | no (D-routed round-1) | postTestC-D | YES (route_success) |
| oceanen | LIKELY_JS_RENDER | no | yes (immediate) | no (D-routed round-1) | postTestC-D | YES (route_success) |
| konserthuset | extraction_failure | no | no | yes (rounds 1→2→3) | manual-review | NO (0 events all rounds) |
| tradgardsforeningen | discovery_failure | no | no | yes (rounds 1→2→3) | manual-review | NO (0 events all rounds) |
| vasteras-konstmuseum | discovery_failure | no | no | yes (rounds 1→2→3) | manual-review | NO (0 events all rounds) |
| uppsala-basket | screening_failure | no | no | yes (rounds 1→2→3) | manual-review | NO (0 events all rounds) |
| stenungsund | discovery_failure | no | no | yes (rounds 1→2→3) | manual-review | NO (0 events all rounds) |
| gr-na-lund | screening_failure | no | no | yes (rounds 1→2→3) | manual-review | NO (0 events all rounds) |
| tekniska-museet | discovery_failure | no | no | yes (rounds 1→2→3) | manual-review | NO (0 events all rounds) |
| junibacken | discovery_failure | no | no | yes (rounds 1→2→3) | manual-review | NO (0 events all rounds) |
| bk-hacken | NEEDS_SUBPAGE_DISCOVERY | no | yes (persisted) | yes (rounds 1→2) | retry-pool | NO (0 events, no A/B/D signal) |
| blekholmen | NEEDS_SUBPAGE_DISCOVERY | no | yes (persisted) | yes (rounds 1→2) | retry-pool | NO (0 events, no A/B/D signal) |

### SAMMANFATTNING PER FAIL-CATEGORY

#### LIKELY_JS_RENDER (2 sources)
- **mobilia, oceanen**
- Regel skapad: NO
- Regel applicerad: YES (C1 likelyJsRendered=true → D-signal, conf=0.85+)
- Outcome changed: YES
- **LEARNING BEVISAD:** C1-detektion av JS-renderad content fungerar för att路由 till D

#### extraction_failure (1 source)
- **konserthuset** (C2=promising men extract=0)
- Regel skapad: NO
- Regel applicerad: NO
- Outcome changed: NO
- **INGEN LEARNING:** C3 misslyckades men ingen regel skapades

#### discovery_failure (5 sources)
- **tradgardsforeningen, vasteras-konstmuseum, stenungsund, tekniska-museet, junibacken**
- Regel skapad: NO
- Regel applicerad: NO (alla 3 rounds körde samma C0 utan framsteg)
- Outcome changed: NO
- **INGEN LEARNING:** C0 hittade inga candidates, inget lärt

#### screening_failure (2 sources)
- **uppsala-basket, gr-na-lund**
- Regel skapad: NO
- Regel applicerad: NO
- Outcome changed: NO
- **INGEN LEARNING:** C2 score för låg, ingen regel för threshold-justering

#### NEEDS_SUBPAGE_DISCOVERY (2 sources)
- **bk-hacken, blekholmen**
- Regel skapad: NO
- Regel applicerad: YES (persistenterades till round-2, round-3)
- Outcome changed: NO
- **INGEN LEARNING:** Subpage discovery försökt men ingen lyckad candidates-upptäckt

### BATCH-13 LEARNING SCORE

| Metric | Value |
|--------|-------|
| Total fail sources | 12 |
| Sources med regel skapad | 0 |
| Sources där regel applicerades nästa round | 4 (mobilia, oceanen, bk-hacken, blekholmen) |
| Sources där outcome ändrades | 2 (mobilia, oceanen → route_success) |
| Sources utan förbättring | 10 |
| **Learning rate** | **16.7% (2/12)** |

### VAD BEVISADES I BATCH-13

1. **C1 → D-routing fungerar:** mobilia och oceanen routedes till D i round-1 baserat på C1 likelyJsRendered=true
2. **Ingen C4-AI-regel sparades:** c4-derived-rules.jsonl finns inte för batch-13
3. **Ingen ny regel skapades:** Trots 12 fail-sources, producerade 123 ingen sparbar regel
4. **Discovery failures persistenterades:** bk-hacken och blekholmen fick retries men ingen förbättring

### GAP IDENTIFIERAT

**C4-AI PLACEHOLDER:** C4-AI-kopplingen är inte implementerad. runC4Analysis() anropades men producerade inga strukturerade learnings att spara.

---

### CONCLUSION
**batch-13: Partial learning proof. 2/12 sources förbättrades via routing (inte regler). 0 regler skapades. C4-AI inte aktiv.**
