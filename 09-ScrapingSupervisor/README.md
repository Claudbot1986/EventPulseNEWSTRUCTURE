# 09-ScrapingSupervisor

Daily observability layer for EventPulse's scraping pipeline. Reads the
runtime state, classifies failures, surfaces findings to the operator, and
auto-retires a narrow class of confirmed-dead sources.

## Pipeline

```
collect_state → analyze_with_llm → auto_apply_safe_fixes → write_reports
```

| Tool | Role |
|------|------|
| `tools/collect_state.ts` | Pure read. Builds `SupervisorState` from `runtime/sources_status.jsonl` + last 5 batch-traces. |
| `tools/analyze_with_llm.ts` | Batch-level pattern synthesis. Uses Claude Haiku 4.5 if `ANTHROPIC_API_KEY` is set; deterministic fallback otherwise. |
| `tools/auto_apply_safe_fixes.ts` | Bounded deterministic rule. Retires ENOTFOUND + persistent-404 sources to `sources/_archive/dead-{date}/`. |
| `tools/write_reports.ts` | Writes vault note + repo doc + suggested-fixes JSONL. |
| `supervisor.ts` | Orchestrator + CLI entry (`runSupervisor`, `main`). |

## Outputs

Per run (one per day unless `main` is invoked more often):

- **Vault note** (rich): `01-Projects/EventPulse/02-Operations/scraping-supervisor/YYYY-MM-DD.md`
- **Repo doc** (concise): `docs/scraping-supervisor/YYYY-MM-DD.md`
- **Suggested-fixes queue**: `runtime/scraping-supervisor/suggested-fixes.jsonl`
- **Applied-fixes log** (append-only): `runtime/scraping-supervisor/applied-fixes.log`
- **Archived sources**: `sources/_archive/dead-{YYYY-MM-DD}/{sourceId}.jsonl`

## Auto-apply scope (per BACKLOG safety)

The supervisor retires ONLY sources whose `lastRoutingReason` matches:

- `ENOTFOUND` — DNS dead, no recovery possible
- `http 404` (or `not found`) AND `consecutiveFailures >= 10` — server explicitly says gone, tried at least 10 times

Anything else (redirect loops, schema drift, URL mismatches) goes to the
**suggested-fixes queue**, never auto-applied.

The supervisor:
- Does NOT modify the `url` field of any source
- Does NOT auto-invoke the four manual fix scripts (`gl-fix-404.py`, etc.)
- Does NOT modify C-layer code
- Does NOT promote sources to working
- Does NOT synthesize extraction outcomes

## Run manually

```bash
cd "/Volumes/2TB filer/NEWSTRUCTURE-COPY"
npx tsx 09-ScrapingSupervisor/supervisor.ts
```

Flags:

- `--dry-run` — preview only, no file moves, no log writes (vault + JSONL still produced)
- `--skip-repo-doc` — skip the `docs/scraping-supervisor/` write
- `--date YYYY-MM-DD` — backfill a specific date (used by tests; the orchestrator defaults to today UTC)

Environment variables (read by `main()`):

- `EVENTPULSE_PROJECT_ROOT` — defaults to `process.cwd()`
- `EVENTPULSE_VAULT_ROOT` — defaults to `/Users/claudgashi/Desktop/MyVault/TomorGashi`

## Schedule daily (macOS launchd)

```bash
cp 09-ScrapingSupervisor/cron/com.eventpulse.supervisor.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.eventpulse.supervisor.plist
```

Runs every day at **04:30** local. Logs go to
`runtime/scraping-supervisor/stdout.log` and `stderr.log`. Adjust
`StartCalendarInterval` in the plist to add a second run (e.g. 12:30 / 16:30).

To inspect / unload:

```bash
launchctl list | grep supervisor
launchctl unload ~/Library/LaunchAgents/com.eventpulse.supervisor.plist
```

## Tests

```bash
npx vitest run 09-ScrapingSupervisor/tests
```

Five test files, 129 tests total:

- `tests/collect_state.test.ts`
- `tests/analyze_with_llm.test.ts`
- `tests/auto_apply_safe_fixes.test.ts`
- `tests/write_reports.test.ts`
- `tests/supervisor.test.ts` (end-to-end integration with synthetic fixtures)

## Idempotency

All writes are idempotent:

- Archives: `sources/_archive/dead-{date}/` is date-stamped; re-running the
  same day produces 0 new moves (the `isAlreadyArchived` check skips already-moved files).
- Suggested-fixes JSONL: de-duplicated by `{date, sourceId, kind}`.
- Vault + repo docs: full-file rewrite, latest content wins.
- `applied-fixes.log`: append-only, never overwritten.

## Anti-hallucination

The LLM layer is allowed to emit `sourceId` references only for ids that
appear in the input state's source id set. Anything else is silently dropped
before write — same pattern as `08-Agent/llmRouter.ts:filterHighlightedIds`.

## See also

- `docs/BACKLOG.md` — "DO NOT BUILD YET" rules (auto-promotion, draining error
  queues, etc.). The supervisor respects these narrowly: it retires only, never promotes.
- `docs/MASTERPLAN.md` — product context.
- Vault note `01-Projects/EventPulse/03-Patterns/43-Scraping-Tools-Survey-2026-08-19.md`
  — survey of every existing operator tool + how the supervisor slots in.