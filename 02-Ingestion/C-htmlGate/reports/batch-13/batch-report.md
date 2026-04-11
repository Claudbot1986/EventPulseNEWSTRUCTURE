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
