/**
 * runA-dai-hook.ts — CLI for D-AI auto-trigger queue
 *
 * Process the queue of sources that runA failed on with 'no-jsonld-or-no-events'.
 * For each queued source, runs the constrained D-AI agent (Anthropic Haiku) to
 * generate a CollectorConfig adapter, saves it to runtime/adapters/{sourceId}.json,
 * and appends to runtime/adapters/_manifest.jsonl. Successful adapters surface
 * in the dashboard's "Review D-AI adapters" tile.
 *
 * Triggered by:
 *   - runA --auto-dai (automatic, after A-batch)
 *   - cron (Supervisor pipeline)
 *   - manual CLI invocation
 *
 * Usage:
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA-dai-hook.ts           # process queue (cap 5)
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA-dai-hook.ts --cap 10  # process up to 10
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA-dai-hook.ts --source-id arbetetsmuseum --url https://...
 *   npx tsx 02-Ingestion/A-directAPI-networkGate/runA-dai-hook.ts --status  # show queue state
 */

import { enqueueDAI, runDaiForQueue, readDaiQueue } from './daiHook.js';

function parseArgs(): { cap: number; sourceId?: string; url?: string; status: boolean } {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    cap: parseInt(get('--cap') || '5', 10),
    sourceId: get('--source-id'),
    url: get('--url'),
    status: argv.includes('--status'),
  };
}

async function main() {
  const args = parseArgs();

  if (args.status) {
    const queue = readDaiQueue();
    console.log('═══ D-AI QUEUE STATE ═══');
    console.log(`Total: ${queue.length} entries`);
    for (const e of queue) {
      console.log(`  ${e.sourceId}: attempts=${e.attempts} reason=${e.reason} enqueuedBy=${e.enqueuedBy} url=${e.url}`);
    }
    return;
  }

  // Manual enqueue + process
  if (args.sourceId && args.url) {
    enqueueDAI(args.sourceId, args.url, 'manual', 'manual');
    console.log(`Enqueued ${args.sourceId} for D-AI generation`);
  }

  // Process queue
  const results = await runDaiForQueue({ cap: args.cap });
  console.log(`\n═══ D-AI RUN SUMMARY ═══`);
  console.log(`Processed: ${results.length}`);
  const ok = results.filter(r => r.validationPassed).length;
  const failed = results.filter(r => r.error).length;
  const skipped = results.filter(r => r.skipped).length;
  console.log(`  ✓ ok:      ${ok}`);
  console.log(`  ✗ failed:  ${failed}`);
  console.log(`  - skipped: ${skipped}`);
  for (const r of results) {
    if (r.skipped) {
      console.log(`  [SKIP] ${r.sourceId}: ${r.skipReason}`);
    } else if (r.error) {
      console.log(`  [FAIL] ${r.sourceId}: ${r.error.slice(0, 100)}`);
    } else {
      console.log(`  [OK]   ${r.sourceId}: conf=${r.aiConfidence} iterations=${r.iterations} → ${r.adapterPath}`);
    }
  }

  process.exit(ok > 0 ? 0 : (failed > 0 ? 2 : 0));
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
