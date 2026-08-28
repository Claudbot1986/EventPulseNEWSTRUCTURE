---
description: Begin an autonomous long-running work session. Loads project state, picks the highest-priority actionable task, and continues executing without requiring user prompting. Use when you want Claude Code to behave like an autonomous engineering lead.
---

# /start — Begin autonomous session

Same as `/resume`, but framed as the *first* invocation of a session
rather than recovery. Both commands reach the same state.

Use `/start` when beginning a fresh autonomous work session after a
process restart, new Claude Code launch, or whenever you want to
hand control to the agent for hours of unattended work.

## What you do on invocation

Exactly the steps in `.claude/commands/resume.md`:

1. `pwd` — confirm project root.
2. Read `00-Execution-Index.md` and follow its links.
3. Reconcile task queue.
4. Pick highest-value work.
5. Decompose and delegate.
6. Execute.
7. Commit + vault-sync + pick next task. Do not stop.
8. Continue until stop condition.

## Initial output

Same one-liner as /resume.

## Recommendation

The user should set `defaultMode: bypassPermissions` in
`.claude/settings.local.json` (already configured in this project) so
that the agent does not pause to ask permission on every command. The
fact-forcing gate hooks will still block unsafe changes by requiring
explicit facts before file writes.

## Limitations

Claude Code cannot literally run forever. Each session is bounded by:
- Context window exhaustion (handled by compaction; vault state survives).
- API rate limits.
- Process termination (handled by fresh-session recovery via /resume).
- User stop (handled by the 5 stop conditions in CLAUDE.md).

For multi-hour unattended execution, start a fresh Claude Code session
periodically and re-invoke /resume. The vault state ensures continuity.
