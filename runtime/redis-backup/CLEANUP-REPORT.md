# Redis Cleanup Report - 2026-04-18

## BEFORE cleanup

| Key family | Count | Description |
|-----------|-------|-------------|
| bull:raw_events:* | 409 | Failed/processed job hashes |
| bull:search_sync:* | 708 | Search sync job hashes |
| bull:events | 1 | Events queue meta |
| bull:ingestion_smoke:* | 1 | Smoke test queue |
| **Total** | **1119** | All bull:* keys |

## Key insight from sample job inspection

Sample `bull:raw_events:*` job data shows:
- **failedReason**: `Insert failed for event (hash: ...)` — events exist as hashes but
  normalizer FAILED to insert them into Supabase (likely network/auth issue with Supabase)
- **processedOn**: timestamps in past — jobs were attempted, failed, and never retried
  because the normalizer worker is not currently running
- **ats** (attempts): 3 — BullMQ exhausted all retry attempts

**Root cause**: Supabase INSERT fails consistently → events sit in Redis as failed jobs.

## Backup files

- Full key list: `runtime/redis-backup/bull-keys-before-clean.txt` (1119 lines)

## AFTER cleanup

| Key family | Remaining |
|-----------|-----------|
| bull:raw_events:* | 2 (stalled-check, meta) |
| bull:search_sync:* | 0 |
| bull:events | 1 |
| bull:ingestion_smoke:* | 1 |
| **Total** | **4** (bara metadata) |

## System is now clean and ready for fresh import test

All EventPulse job data (raw_events, search_sync) removed.
Only BullMQ internal metadata keys remain.

## Next steps

1. Verify Supabase connectivity before running normalizer
2. Start normalizer worker: `npx tsx 03-Queue/startWorker.ts`
3. Run A-spår: `npx tsx 02-Ingestion/A-directAPI-networkGate/runA.ts --limit 1`
4. Watch for events reaching Supabase (not failing)
5. Then run importToEventPulse for preUI sources
