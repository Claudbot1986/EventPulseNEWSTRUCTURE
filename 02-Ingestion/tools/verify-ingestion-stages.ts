/**
 * verify-ingestion-stages.ts
 *
 * Verifierar att alla importerade sources har en tydlig ingestionStatus.
 * Kör: npx tsx 02-Ingestion/tools/verify-ingestion-stages.ts
 * Med --fix: npx tsx 02-Ingestion/tools/verify-ingestion-stages.ts --fix
 */

import { getAllSources, getSourceStatus, getAllStatuses, ensureSourceStatus } from './sourceRegistry';

function main() {
  const args = process.argv.slice(2);
  const doFix = args.includes('--fix');

  const sources = getAllSources();
  const statuses = getAllStatuses();
  const statusMap = new Map(statuses.map(s => [s.sourceId, s]));

  // Collect stats
  const stageCounts: Record<string, number> = {};
  const manualreviewPending: string[] = [];
  const missingStatus: string[] = [];

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Ingestion Stage Verification           ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`Total sources: ${sources.length}`);
  console.log(`Total statuses: ${statuses.length}`);

  for (const source of sources) {
    const status = statusMap.get(source.id);
    const stage = status?.ingestionStage ?? 'missing';
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;

    // Check manualreview sources
    const requiresManualReview = (source as any).requiresManualReview === true;
    if (requiresManualReview && stage === 'pending') {
      manualreviewPending.push(source.id);
    }

    // Track sources without status
    if (!status) {
      missingStatus.push(source.id);
    }
  }

  console.log('\n─── ingestionStage breakdown ───');
  const stages = ['missing', 'pending', 'A', 'B', 'C', 'D', 'completed', 'failed'] as const;
  for (const stage of stages) {
    const count = stageCounts[stage] ?? 0;
    const pct = sources.length > 0 ? ((count / sources.length) * 100).toFixed(0) : '0';
    const marker = count > 0 ? '◉' : '○';
    console.log(`  ${marker} ${stage.padEnd(12)} ${String(count).padStart(4)} (${pct}%)`);
  }

  console.log('\n─── Key counts ───');
  const pendingCount = stageCounts['pending'] ?? 0;
  const completedCount = stageCounts['completed'] ?? 0;
  const failedCount = stageCounts['failed'] ?? 0;
  const missingCount = stageCounts['missing'] ?? 0;
  const neverRunCount = statuses.filter(s => s.status === 'never_run').length;
  const manualreviewCount = sources.filter(s => (s as any).requiresManualReview === true).length;

  console.log(`  pending:       ${pendingCount}`);
  console.log(`  completed:     ${completedCount}`);
  console.log(`  failed:        ${failedCount}`);
  console.log(`  missing:       ${missingCount}`);
  console.log(`  never_run:     ${neverRunCount}`);
  console.log(`  manualreview:  ${manualreviewCount}`);

  console.log('\n─── manualReview sources still pending ───');
  if (manualreviewPending.length === 0) {
    console.log('  none ✓');
  } else {
    for (const id of manualreviewPending) {
      const status = statusMap.get(id);
      const neverRun = status?.status === 'never_run';
      if (neverRun) {
        console.log(`  ○ ${id} — never_run, waiting in queue (not blocked)`);
      } else {
        console.log(`  ⚠ ${id} — tried but stuck at ${status?.ingestionStage}`);
      }
    }
  }

  // ── FIX MODE ───────────────────────────────────────────────────────────────
  if (doFix && missingCount > 0) {
    console.log(`\n─── Fixing: Creating ${missingCount} missing status entries ───`);
    for (const sourceId of missingStatus) {
      ensureSourceStatus(sourceId);
      console.log(`  + created status for: ${sourceId}`);
    }
    console.log('  ✓ All missing status entries created');
  }

  // ── VERIFICATION ──────────────────────────────────────────────────────────
  console.log('\n─── Verification ───');
  let ok = true;

  if (missingCount > 0) {
    console.log(`  ✗ ${missingCount} sources have no status — run with --fix to create entries`);
    ok = false;
  } else {
    console.log(`  ✓ All ${sources.length} sources have status entries`);
  }

  // Only warn about manualreview sources that have been TRIED but are stuck
  const manualreviewStuck = manualreviewPending.filter(id => {
    const s = statusMap.get(id);
    return s && s.status !== 'never_run';
  });
  if (manualreviewStuck.length > 0) {
    console.log(`  ⚠ ${manualreviewStuck.length} manualreview sources are stuck at pending`);
    console.log(`    (manualreview is a TAG, not a blocker — they should run through A/B/C/D)`);
  } else {
    console.log(`  ✓ No manualreview sources stuck at pending`);
  }

  // Show manualreview sources that have progressed
  const manualreviewProgressed = statuses.filter(s => {
    const src = sources.find(src => src.id === s.sourceId);
    return src && (src as any).requiresManualReview === true && s.ingestionStage !== 'pending';
  });
  if (manualreviewProgressed.length > 0) {
    console.log(`\n─── manualReview sources that have progressed ───`);
    for (const s of manualreviewProgressed.slice(0, 10)) {
      console.log(`  ✓ ${s.sourceId.padEnd(25)} stage=${s.ingestionStage} status=${s.status}`);
    }
  }

  console.log('\n════════════════════════════════════');
  if (ok && manualreviewStuck.length === 0) {
    console.log('ALL CHECKS PASSED ✓');
  } else {
    console.log('SOME CHECKS NEED ATTENTION ✗');
  }
  console.log('════════════════════════════════════\n');
}

main();
