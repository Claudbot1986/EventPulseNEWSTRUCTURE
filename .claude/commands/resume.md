---
description: Resume autonomous execution — load vault state, reconcile task queue, pick highest-value work, continue the loop. Use at the start of a session to begin long-running autonomous work, or after context loss / compaction to recover and continue.
---

# /resume — Resume autonomous execution

The user invokes this slash command to start an autonomous work session.
The agent then executes the full recovery sequence and continues the
autonomous execution loop described in `CLAUDE.md` "Autonomous Execution
Loop" section.

## What you do on invocation

1. **Confirm working directory.** Run `pwd`. Must be the project root
   (`/Volumes/2TB filer/NEWSTRUCTURE-COPY`). If not, stop and tell the user.

2. **Run the recovery sequence.** Read the files linked from
   `00-Vault/01-Projects/EventPulse/00-Core/00-Execution-Index.md` in
   the order given there.

3. **Reconcile the task queue.**
   - Read `02-Operations/23-Active-Task-Queue.md` (the persistent mirror).
   - Compare to the live TaskList.
   - If they diverge: the vault queue is the source of truth (it persists
     across sessions). Update TaskList to match.
   - Spawn `vault-sync` to re-annotate the queue with current counts.

4. **Pick the highest-value work.** From the queue:
   - P0 first (blocks other work).
   - Then P1, P2, P3.
   - Skip `blocked` and `done`.

5. **Decompose.** Can this task be split into independent workstreams that
   benefit from parallel execution? If yes, spawn `work` sub-agents in
   parallel. If no, execute directly.

6. **Execute / delegate.** Run the task or supervise the sub-agents.

7. **After the task:** commit, mark done in vault queue, spawn
   `vault-sync`, then immediately pick the next task. **Do not stop.**

8. **Continue the loop.** Only stop for the five stop conditions listed in
   CLAUDE.md (user decision, external dependency, protected-strategy
   change, no meaningful work, safety boundary).

## Stop condition for /resume specifically

If, after step 4, the queue is empty AND there are no discoveries in
`24-Discovered-Work.md` AND no blockers in `05-Blockers-and-Risks.md`,
tell the user:

> Autonomous queue is empty. No meaningful work remaining right now.
> If you have a new objective, give it to me; otherwise this session has
> nothing productive to do.

Then stop. Otherwise: continue.

## Output format

After recovery, the first thing the user sees is a one-line status:

```
Resumed: branch=<branch> commit=<hash> tests=<passed>/<total> queue=P0=1 P1=1 P2=5 P3=1 next=T0001 "<title>"
```

Then immediately begin work on the next task. Do not ask the user for
confirmation — the user invoked /resume precisely because they want
autonomous execution.
