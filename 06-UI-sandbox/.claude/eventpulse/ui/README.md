# EventPulse UI Brain

The canonical UI/UX knowledge layer for AI coding agents working in
EventPulse's `06-UI-sandbox/`. Read this before writing any UI.

## What this is

A persistent, opinionated reference for EventPulse UI quality. It
combines:

- **Existing rules** — what the current EventPulse code already does.
  These are binding.
- **Recommended improvements** — what experienced agents would change.
  These are suggestions, not mandates. Flag them in PRs, do not silently
  enforce.

## Files

| File | Purpose |
|---|---|
| `README.md` | This index. |
| `UI_RULES.md` | Core rules. Anti-AI patterns. When to break a rule. |
| `DESIGN_SYSTEM.md` | Extracted tokens (color, type, space, radius, elevation). Existing vs Recommended. |
| `COMPONENT_RULES.md` | How to build a component. File layout, naming, anatomy. |
| `TYPOGRAPHY.md` | Type roles. When to add a new role. |
| `SPACING.md` | Spacing scale. Why 4/8/12/16/20/24/32/48. |
| `MOTION.md` | Motion rules. Reduced motion. Press feedback. |
| `ACCESSIBILITY.md` | A11y baseline. Roles, labels, targets, contrast. |
| `SCREEN_STATES.md` | Loading, empty, error, success, disabled, focus. |
| `UI_REVIEW.md` | Self-critique checklist before declaring done. |

## How to use this

1. **Before** any UI task, read `UI_RULES.md` + `DESIGN_SYSTEM.md`.
2. **Before** building a component, read `COMPONENT_RULES.md`.
3. **Before** declaring done, run `UI_REVIEW.md` self-critique.
4. **If** the task involves motion, read `MOTION.md`.
5. **If** the task involves a form or input, read `ACCESSIBILITY.md`.
6. **If** the task introduces a new state, read `SCREEN_STATES.md`.

## Cross-references

The repo-level skill is at `.claude/skills/frontend-design/` (sibling
to `jev-advisor/`). That skill is the "what to do" entry point; this
directory is the "how EventPulse does it" detail. They reference each
other — read both.

## Status of recommendations

Every recommendation is marked:

- **[EXISTING]** — already used in the codebase. Treat as binding.
- **[RECOMMENDED]** — proposed by an agent or skill. Discuss before
  enforcing. If you adopt one, update this file and link the PR.
- **[REJECTED]** — proposed but rejected. Do not re-propose without new
  evidence.

If you disagree with an [EXISTING] rule, raise it as a decision in
`01-Projects/EventPulse/02-Operations/` (vault), not as a silent change.
