---
name: jev-advisor
description: Consult Jev (TypeSafe AI decision model via OpenRouter) for a quick second opinion on a non-trivial decision. Use before making UI changes, picking between approaches, evaluating tradeoffs, or naming things. Returns probability / choice / score — not reasoning. Jev advises; Claude decides.
type: skill
---

# Jev Advisor

When you're about to make a non-trivial decision and want a second opinion, run:

```bash
python3 scripts/jev-call.py \
  --type <noul|choice|score> \
  --state "<context, ≤140 chars ideally>" \
  --question "<the question>" \
  [--criteria "<k:v,k:v>" for choice/score] \
  [--action "<what you'll do based on the answer>"]
```

## When to invoke

ALL of these must be true:
- Non-trivial decision (>1 reasonable approach)
- Reversible (we can change our mind without major rework)
- Measurable upside from getting it right

## When NOT to invoke

- Trivial choices (naming, formatting, imports)
- Strategic CLAUDE.md-protected truths (North Star, product direction, target customer) — Jev never votes here
- Obvious answers from immediate context

## Tell the user

Always tell the user you called Jev. Format:

> Jag frågade Jev om [fråga] — den sa [svar]. Jag tänker [approach]. OK?

## Schema notes

- `noul`: returns 0..1 probability. No criteria needed.
- `choice`: criteria must be object `{label: description, ...}`. Up to 255 alternatives.
- `score`: criteria must be **array** `[[level, description], ...]` — object form is rejected by OpenRouter.

## Ledger

Every call writes to `docs/operations/jev-decisions.md`. Read it occasionally to spot patterns in our decisions.

## Cost & latency

~$0.000013 per call. 70–500 ms latency. Don't invoke on every tool call — only when a real decision is on the table.

## Rollback

Empty or remove `OPENROUTER_API_KEY` in `.env`. Script fails safely with clear error.
