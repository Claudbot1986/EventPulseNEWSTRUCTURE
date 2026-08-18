# Tool 18 Retry Loop

Status: verified 2026-04-27

Tool 18 must drain `runtime/preA-queue.jsonl` through the real A-B-C-D pipeline. It must not synthesize extraction results.

## Verified Retry Procedure

When a Tool 18 run leaves sources in a failing queue because of a tool/runtime error:

1. Snapshot runtime queues with `python3 queue-mem.py snapshot <name>`.
2. Move the affected queue back to `preA` with `python3 queue-mem.py reset-all <queue>`.
3. Fix the root cause in the owning tool.
4. Add or update regression tests.
5. Run `python3 Alltools-E2E/e2e_drain_prea.py`.
6. Repeat until Tool 18 exits `0` and these queues are empty:
   - `runtime/preA-queue.jsonl`
   - `runtime/postB-preC-queue.jsonl`
   - `runtime/postTestC-error500.jsonl`

## 2026-04-27 Fixes

- C0 frontier discovery now skips malformed absolute `href` values instead of aborting the source.
- Shared `fetchHtml()` normalizes bare source domains such as `abf.se/` to `https://abf.se`.
- `scB-diagnostic` no longer labels successful diagnostic fetches with no actionable fetch blocker as `unknown_500_error`; those remain in manual review.

## Verified Outcome

The retry loop was run against `postTestC-error500` until:

- `preA`: 0
- `postB-preC`: 0
- `postTestC-error500`: 0
- latest Tool 18 retry run: `exit_code: 0`

Terminal queues such as `postTestC-manual-review`, `postTestC-404`, `postTestC-serverdown`, `postTestC-timeout`, `postTestC-D`, and `postD-man` are not Tool 18 crash queues. They represent terminal routing or separate follow-up tools.
