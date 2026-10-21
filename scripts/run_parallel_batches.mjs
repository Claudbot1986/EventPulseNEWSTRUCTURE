#!/usr/bin/env node
/**
 * scripts/run_parallel_batches.mjs
 *
 * Kör N parallella batcher där varje batch har en egen kategori-partition
 * SÅ att batcherna inte genererar samma (cat, tag, zoom, pose, light).
 *
 * State-filen state/zoom-coverage.json är atomic via writeFileSync+rename —
 * batcher som försöker samma combo skip:as automatiskt efter den första
 * registrerat den. weighted CU/EC/MCU-distribution prioriteras inom varje
 * kategori (befintlig ZOOM_WEIGHTS i zoom-prompter.ts).
 *
 * Kör: node scripts/run_parallel_batches.mjs
 *
 * Default: 10 batcher × 30 bilder = 300 prompts totalt (state.skip:ar dupes).
 */

const URL = 'http://localhost:7777';
const N_PER_BATCH = parseInt(process.argv[2] ?? '30', 10);
const CONCURRENCY = parseInt(process.argv[3] ?? '10', 10);

// Kategorier med cluster-filer (vi hoppar de som saknas)
// Från quota-scriptet: rock, electronic, classical, opera, dance,
// theatre-drama, theatre-comedy, music, community, workshop, family, kids,
// food, musical-theatre, sports, exhibition, circus, jazz, pop,
// nightlife, film, wine-tasting, flea-market, talks-lectures
const PARTITIONS = [
  ['music'],
  ['community'],
  ['rock', 'electronic'],
  ['theatre-drama', 'theatre-comedy'],
  ['classical', 'opera', 'dance'],
  ['workshop', 'family', 'kids'],
  ['food', 'musical-theatre', 'sports'],
  ['exhibition'],
  ['circus', 'jazz', 'pop'],
  ['nightlife', 'film', 'wine-tasting', 'flea-market', 'talks-lectures'],
];

async function startBatch(categories, count) {
  const r = await fetch(`${URL}/api/bfl/zoom-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count, categories, variant: 'legacy' }),
  });
  return await r.json();
}

async function pollBatch(runId) {
  const t0 = Date.now();
  while (true) {
    const r = await fetch(`${URL}/api/bfl/zoom-run/${runId}/status`);
    if (!r.ok) return null;
    const d = await r.json();
    const s = d.result;
    if (!s) return null;
    if (s.status === 'success' || s.status === 'failed') {
      return { ...s, timeSec: Math.round((Date.now() - t0) / 1000) };
    }
    await new Promise(r => setTimeout(r, 4000));
  }
}

async function main() {
  console.log(`=== START ${PARTITIONS.length}×${N_PER_BATCH} parallella batcher (concurrency=${CONCURRENCY}) ===`);
  console.log(`Partitioner:`);
  for (let i = 0; i < PARTITIONS.length; i++) {
    console.log(`  batch ${i + 1}: [${PARTITIONS[i].join(', ')}]`);
  }

  const diskBefore = parseInt((await import('node:child_process')).execSync(
    `find local_image_library_stamped -name 'zoom_*.webp' 2>/dev/null | wc -l | tr -d ' '`, { encoding: 'utf8' }
  ).trim());
  console.log(`\nDISK_BEFORE=${diskBefore}\n`);

  // Starta alla batcher parallellt
  const t0 = Date.now();
  const starts = await Promise.all(
    PARTITIONS.slice(0, CONCURRENCY).map((cats) => startBatch(cats, N_PER_BATCH))
  );
  const runIds = starts.map((s) => s.runId);
  console.log(`\nStartade ${runIds.length} batcher:`);
  for (let i = 0; i < runIds.length; i++) {
    console.log(`  batch ${i + 1} (${PARTITIONS[i].join(',')}): runId=${runIds[i]} count=${starts[i].count}`);
  }

  // Polling tills alla klara
  console.log(`\nPolling...`);
  const results = await Promise.all(runIds.map((rid) => pollBatch(rid)));

  const diskAfter = parseInt((await import('node:child_process')).execSync(
    `find local_image_library_stamped -name 'zoom_*.webp' 2>/dev/null | wc -l | tr -d ' '`, { encoding: 'utf8' }
  ).trim());
  const totalTime = Math.round((Date.now() - t0) / 1000);

  console.log(`\n=== RESULTAT ===`);
  console.log(`Disk: ${diskBefore} → ${diskAfter} (delta=${diskAfter - diskBefore})`);
  console.log(`Total tid: ${totalTime}s`);

  let totalImages = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r) {
      console.log(`  batch ${i + 1} (${PARTITIONS[i].join(',')}): status=${r.status} imageCount=${r.imageCount}/${r.count} time=${r.timeSec}s`);
      totalImages += r.imageCount || 0;
    } else {
      console.log(`  batch ${i + 1} (${PARTITIONS[i].join(',')}): TIMEOUT`);
    }
  }
  console.log(`\nTotalt imageCount rapporterat: ${totalImages}`);
  console.log(`Total disk delta: ${diskAfter - diskBefore}`);
  if (totalImages !== diskAfter - diskBefore) {
    console.log(`⚠️  DiskDelta > imageCount: några bilder producerades utanför dessa batcher (eller inte state-registrerade)`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(2);
});
