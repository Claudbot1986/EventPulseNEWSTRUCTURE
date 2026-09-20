# Setup for AI source-review (LLM path)

The supervisor's `source_ai_review.ts` and `analyze_with_llm.ts` use MiniMax
(`MiniMax-M2.7` via `02-Ingestion/AI/minimaxConfig.ts`) when
`MINIMAX_API_KEY` is set. The key is loaded automatically from the project
root `.env` (dotenv inside minimaxConfig) — no launchd env setup needed;
each cron run re-reads `.env`. Without the key, only deterministic regex
rules run and most proposals stay at `confidence: medium` (queued for human
review).

## Quick test (one-shot, no waiting for the cron)

```bash
npx tsx 09-ScrapingSupervisor/supervisor.ts \
  --skip-repo-doc --date 2026-08-19
```

Look for these lines in stdout:

```
LLM: MiniMax-M2.7
source-review: N proposals (llm=K) applied=A queued=B
```

`llm=K > 0` confirms the LLM path is active.

## What the LLM path does

For sources that don't match a deterministic rule (e.g. NO_JSONLD with
no C1 subpage evidence), the LLM gets:

- The source's current `lastRoutingReason`
- The most recent batch trace (`c0Candidates`, `c1BestSubpageFound`,
  `c2Score`, etc.)
- The source's URL

…and proposes ONE narrow source-specific action:

- `update-preferred-path` (with a candidate path the LLM saw in the trace)
- `mark-review-needed` (when evidence is ambiguous)
- `no-change` (when nothing actionable)

Anti-hallucination: LLM-returned `sourceId` values are intersected against
the input set; any hallucinated id is silently dropped. Only HIGH confidence
+ `needsHumanReview: false` auto-apply.

## Model choice

The model is fixed centrally in `02-Ingestion/AI/minimaxConfig.ts`
(`AI_CONFIG.model`) — the supervisor and the ingestion gates share provider.
