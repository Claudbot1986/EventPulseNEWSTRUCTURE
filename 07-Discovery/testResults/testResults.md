# 07-Discovery/testResults

## Purpose

Contains test results and validation reports for the discovery layer: expansion tests, venue graph tests, multi-hop BFS validation, and priority scoring tests.

## What belongs here

- Expansion batch test output
- Venue graph validation reports
- Priority scoring tests
- Discovery queue processing results

## What does NOT belong here

- Ingestion test results (belongs to `02-Ingestion/testResults/`)
- Queue test results (belongs to `03-Queue/testResults/`)

## Status

**Status: Venue Graph v0 + Source Candidate Testing local verification**

Latest focused verification:
- `npx vitest run "07-Discovery/src/venueGraph/venueGraph.test.ts"` — 8/8 tests passed.
- `npx tsc --noEmit --pretty false --skipLibCheck --module NodeNext --moduleResolution NodeNext --target ES2020 "07-Discovery/src/venueGraph/venueGraph.test.ts" "06-UI/services/ingestion/src/discovery/expansionWorker.ts"` — passed.
- `npx tsc --noEmit --pretty false --skipLibCheck --target ES2020 --module CommonJS --moduleResolution node --esModuleInterop --strict "06-UI/services/ingestion/src/discovery/expansionWorker.ts"` — passed.
- `npm run venue-graph:dry-run -- --limit=10` — passed against real Supabase connection with 10 input events, 197 venues, 212 nodes, 15 edges, 2 observations, 0 candidates, 0 rejected observations.
- `npx vitest run "07-Discovery/src/sourceTesting/sourceCandidateTesting.test.ts"` — 6/6 tests passed.
- Focused source-testing TypeScript check passed for `07-Discovery/src/sourceTesting/*.ts`.
- `python3 -m py_compile "Alltools-E2E/e2e.py" "Alltools-E2E/core/real_pipeline.py"` — passed after sandbox data-root support.
- Code-review re-check found no remaining blocker after limiting candidate tests to sandboxed A/B/C/D and removing dry-run based decisions.
- `npx vitest run "07-Discovery/src/sourceTesting/sourceCandidateTesting.test.ts" "tests/dashboard-live.test.ts"` — 24/24 tests passed after Discovery-UI retention/archive and status-summary integration.
- Focused TypeScript check passed for source-testing Discovery-UI files plus `dashboard-live.ts` and `tests/dashboard-live.test.ts`.

Not yet verified:
- Supabase migration apply for `05-Supabase/migrations/20260427-0001-venue-graph.sql`.
- Supabase migration apply for `05-Supabase/migrations/20260427-0002-source-candidate-testing.sql`.
- Small `npm run venue-graph:apply -- --limit=...` after migration.
- Real source-candidate sanity/breadth/smoke run against a live candidate after both migrations are applied.
- Live promoted candidate visible in `runtime/discovery-ui-queue.jsonl` and dashboard terminal after an actual smoke/promotion run.
- Full `npx tsc -p 06-UI/services/ingestion/tsconfig.json --noEmit` still reports existing unrelated ingestion TypeScript errors outside the Venue Graph worker path.
- Full root `npx tsc --noEmit` still reports existing unrelated TypeScript errors in older ingestion files; source-testing files passed focused type-check.

Keep raw output for debugging when real DB verification starts.
