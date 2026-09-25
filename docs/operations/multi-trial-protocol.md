# Multi-Mode Trial Protocol

Three decision-support patterns, each tested in its appropriate scenario across ~5 sessions and ~25 calls total.

## Modes at a glance

| Mode | Script | When to use | Cost/call | Latency |
|---|---|---|---|---|
| **advisor** | `scripts/jev-call.py` | Routine dev decisions (naming, A vs B, "commit now?") | ~$0.000013 | ~0.5s |
| **council** | `scripts/council-call.py` | Major architectural decisions | ~$0.05–0.20 | ~5–15s |
| **dual** | `scripts/dual-call.py` | Cross-validation of specific content | ~$0.01–0.05 | ~3–8s |

All three log to `docs/operations/jev-decisions.md` and increment the same trial counter in `docs/operations/jev-trial-state.json`.

---

## Session plan

| Session | Mode(s) | Calls | Purpose |
|---|---|---|---|
| 1 | advisor | ~6 | Jev hit-rate, latency feel, rubric compliance |
| 2 | advisor | ~6 | Continue — accumulate T1–T6 data |
| 3 | advisor | ~6 | Final advisor batch |
| 4 | council | ~4 | Real architectural decision: does multi-perspective add value? |
| 5 | dual | ~3 | Cross-validate content: does conflict-flagging help? |

Target total: ~25 calls. Auto-evaluation triggers when `calls_total >= target_calls_total` (25).

---

## What's tested

### Layer A — Hook / counter (instrumentation)

| ID | What | Pass criterion |
|---|---|---|
| H1 | Counter increments by exactly 1 per call | `calls_total` increases by 1, never 0 or 2 |
| H2 | No double-fire | Concurrent calls don't double-count |
| H3 | Budget boundary triggers eval | At `calls_total == 25`, eval runs once |
| H4 | State persists across sessions | JSON file survives Claude Code restart |
| H5 | Eval runs only once | `status: evaluated` blocks re-eval |
| H6 | Visibility — user sees counter | Each call prints `[trial X/Y]` (TODO) |

### Layer B — Advisor trial (sessions 1–3)

| ID | What | Measurement |
|---|---|---|
| T1 | Jev hit rate | My final decision ≈ Jev's suggestion |
| T2 | Rubric compliance | Did I consult Jev on the right decisions? |
| T3 | Latency in practice | Did 0.5s feel disruptive? (logged subjectively) |
| T4 | Cost in practice | Total $ across advisor calls |
| T5 | Override rate | How often I (or user) overrode Jev |
| T6 | Type distribution | noul / choice / score counts |

### Layer C — Council trial (session 4)

| ID | What | Measurement |
|---|---|---|
| T-C1 | Final quality vs Jev | Would Jev alone have given a worse answer? |
| T-C2 | Latency tolerable? | 5–15s acceptable for big decisions? |
| T-C3 | Cost vs benefit | Is the extra $0.10+ worth it? |
| T-C4 | Peer review value | Did stage-2 rankings surface weaknesses stage-1 missed? |

### Layer D — Dual trial (session 5)

| ID | What | Measurement |
|---|---|---|
| T-D1 | Conflict rate | How often Claude vs Gemini disagreed |
| T-D2 | Conflict meaningfulness | When they disagreed, was the signal useful? |
| T-D3 | Cost efficiency | Cheaper than council for cross-validation? |

---

## Auto-verdict at budget boundary

When `calls_total >= target_calls_total`:

1. State file flips `status: active → evaluated`
2. Evaluator (TODO: `scripts/jev-trial-evaluate.py`) reads the ledger
3. Aggregates metrics across all three modes
4. Asks Jev: "Score this trial 1–10"
5. I (Claude) read the same data and write a verdict
6. Final verdict is one of:
   - `keep_advisor` — advisor is the right default; council/dual are over-engineered for dev-time
   - `escalate_council_for_big_decisions` — advisor default, council for major architecture
   - `escalate_dual_for_review_tasks` — advisor default, dual for PR review / content validation
   - `rebalance` — adjust call distribution across modes

---

## Anti-cross-contamination

The trial **must not**:
- Affect runtime product code (it's dev-time only)
- Bypass CLAUDE.md-protected decisions (North Star, product direction)
- Replace the user's authority (Jev/council/dual *advise*, you and I decide)

The trial **may**:
- Modify the 4 scripts (`jev-call.py`, `council-call.py`, `dual-call.py`, future evaluator)
- Modify the trial state and protocol files
- Append to the ledger

---

## Rollback

Set `JEV_TRIAL_DISABLED=1` in `.env` to make all three scripts skip the counter increment. (Not yet implemented in MVP — would be a 1-line check in each script.)

Empty `OPENROUTER_API_KEY` to disable all three scripts entirely.
