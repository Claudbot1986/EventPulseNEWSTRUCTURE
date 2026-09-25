---
name: jev
description: Ask Jev for a quick second opinion. Defaults to noul (yes/no probability).
type: command
---

# /jev — quick second opinion from Jev

## Usage

`/jev <question>` — defaults to `noul` (yes/no probability 0..1)

`/jev choice: <question>` — picks among 2–255 alternatives (you provide them in the question or follow-up)

`/jev score: <question>` — graded score 1..10 (you specify scale in the question)

## Examples

- `/jev Should I add a new npm dependency for one icon?`
- `/jev choice: Which CSS approach — tailwind, css-modules, or styled-components?`
- `/jev score: How good is my plan to add a feature flag system? 1=poor 10=excellent`

## Under the hood

Delegates to `python3 scripts/jev-call.py`. Every call is logged to `docs/operations/jev-decisions.md`.

## When to use this directly

- You want a second opinion **without** Claude's framing
- You're testing the tool
- You disagree with Claude's read on something — bypass Claude, ask Jev
