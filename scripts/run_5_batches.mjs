#!/usr/bin/env node
/**
 * scripts/run_5_batches.mjs
 *
 * Kör N batcher × 10 bilder med --reset-state, snapshot parallellt för UI-bevakning,
 * logga alla imageCount-tickningar så vi kan se om räknaren tickar upp korrekt.
 *
 * Kör: node scripts/run_5_batches.mjs [antal-batcher] [count]
 *   default: 5 batcher × 10 bilder
 */
import { execSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';

const N = parseInt(process.argv[2] ?? '5', 10);
const COUNT = parseInt(process.argv[3] ?? '10', 10);
const URL = 'http://localhost:7777';
const OUT = `tmp/5-batches-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`;

function log(line) {
  console.log(line);
  appendFileSync(OUT, line + '\n');
}

log(`=== START ${N}×${COUNT} körningar (${new Date().toISOString()}) ===`);

const totals = [];

for (let i = 1; i <= N; i++) {
  log('');
  log(`=== BATCH ${i}/${N} START ===`);
  const t0 = Date.now();
  const resp = execSync(
    `curl -s -X POST ${URL}/api/bfl/zoom-run -H 'Content-Type: application/json' -d '{"count":${COUNT},"resetState":true}'`,
    { encoding: 'utf8' }
  );
  const j = JSON.parse(resp);
  const runId = j.runId;
  log(`  runId=${runId}  count=${j.count}`);

  // Starta snapshot för denna batch
  const snapLabel = `batch-${i}`;
  const snapOut = `tmp/snap-${i}.log`;
  const snap = execSync(`node scripts/snapshot_live.mjs ${snapLabel} 120 > ${snapOut} 2>&1 &`, { encoding: 'utf8' }).toString();
  log(`  snapshot startat: ${snapLabel} (ut=evidence/live/${snapLabel})`);

  // Polling
  let lastCount = -1;
  let lastDisk = -1;
  let diskBefore = parseInt(execSync(`find local_image_library_stamped -name 'zoom_*.webp' 2>/dev/null | wc -l | tr -d ' '`, { encoding: 'utf8' }).trim());
  log(`  disk_before=${diskBefore}`);

  while (true) {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    if (elapsed > 200) { log(`  TIMEOUT 200s`); break; }

    const stateResp = execSync(`curl -s ${URL}/api/bfl/zoom-run/${runId}/status`, { encoding: 'utf8' });
    const s = JSON.parse(stateResp).result || {};
    const status = s.status ?? '?';
    const count = s.imageCount ?? 0;
    const lastLog = ((s.log ?? ['']).slice(-1)[0] ?? '').slice(0, 90);
    const disk = parseInt(execSync(`find local_image_library_stamped -name 'zoom_*.webp' 2>/dev/null | wc -l | tr -d ' '`, { encoding: 'utf8' }).trim());

    if (count !== lastCount || disk !== lastDisk) {
      log(`  t=${elapsed}s status=${status} count=${count}/${COUNT} disk=${disk} (Δdisk=${disk-diskBefore}) lastLog=${lastLog}`);
      lastCount = count;
      lastDisk = disk;
    }

    if (status === 'success' || status === 'failed') break;
    await new Promise(r => setTimeout(r, 4000));
  }

  const finalState = JSON.parse(execSync(`curl -s ${URL}/api/bfl/zoom-run/${runId}/status`, { encoding: 'utf8' })).result || {};
  const totalTime = Math.round((Date.now() - t0) / 1000);
  const diskAfter = parseInt(execSync(`find local_image_library_stamped -name 'zoom_*.webp' 2>/dev/null | wc -l | tr -d ' '`, { encoding: 'utf8' }).trim());
  const newFiles = diskAfter - diskBefore;
  const ticks = [];

  totals.push({
    batch: i,
    runId,
    status: finalState.status,
    count: finalState.count,
    imageCount: finalState.imageCount,
    diskBefore,
    diskAfter,
    newFiles,
    timeSec: totalTime,
  });

  log(`  ✓ BATCH ${i} KLAR: status=${finalState.status} imageCount=${finalState.imageCount}/${finalState.count} newFiles=${newFiles} time=${totalTime}s`);
}

log('');
log('=== SAMMANFATTNING ===');
log(`  total new files: ${totals.reduce((a, b) => a + b.newFiles, 0)}`);
log(`  total time: ${totals.reduce((a, b) => a + b.timeSec, 0)}s`);
for (const t of totals) {
  log(`  batch ${t.batch}: imageCount=${t.imageCount}/${t.count}  newFiles=${t.newFiles}  time=${t.timeSec}s  status=${t.status}`);
}
