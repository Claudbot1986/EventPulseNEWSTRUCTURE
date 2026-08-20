# Setup for AI source-review (LLM path)

The supervisor's `source_ai_review.ts` uses Claude Haiku 4.5 when
`ANTHROPIC_API_KEY` is set in the launchd environment. Without the key,
only deterministic regex rules run and most proposals stay at
`confidence: medium` (queued for human review).

## One-time setup

```bash
# Set the key globally for all launchd jobs (the supervisor picks it up
# automatically because the plist inherits EnvironmentVariables from
# launchd's domain).
launchctl setenv ANTHROPIC_API_KEY "sk-ant-..."

# Verify it propagated (will print the key — keep this terminal private).
launchctl getenv ANTHROPIC_API_KEY

# Reload the supervisor plist so the new env is picked up.
launchctl unload ~/Library/LaunchAgents/com.eventpulse.supervisor.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.eventpulse.supervisor.plist

# Verify the job is loaded.
launchctl list | grep eventpulse
```

## Quick test (one-shot, no waiting for the cron)

```bash
# Make sure the key is in your current shell.
export ANTHROPIC_API_KEY="sk-ant-..."
npx tsx /Volumes/2TB\ filer/NEWSTRUCTURE-COPY/09-ScrapingSupervisor/supervisor.ts \
  --skip-repo-doc --date 2026-08-19
```

Look for this line in stdout:

```
LLM: claude-haiku-4-5-20251001
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

## Per-host override (when you want different model per environment)

Set `ANTHROPIC_MODEL=claude-haiku-4-5-20251001` (default) or another model.