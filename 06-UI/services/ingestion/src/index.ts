// Load dotenv FIRST
import * as dotenv from 'dotenv';
dotenv.config({ override: true }); // override inherited env vars
import cron from 'node-cron';
import { createNormalizerWorker } from './queue';
import { processRawEvent } from './normalizer';
import { scrapeTicketmaster } from './sources/ticketmaster';
import { scrapeEventbrite } from './sources/eventbrite';
import { scrapeBilletto } from './sources/billetto';
import { scrapeStockholm, generateStockholmSamples } from './sources/stockholm';
import { runKulturhusetSource } from './sources/sourceRunner';
import { initSearchIndex, isMeilisearchConfigured } from './search';
import { startSearchWorker } from './searchWorker';
import { getQueueStats, fetchNextExpansionCandidates, processExpansionBatch } from './discovery/expansionWorker';
import { runMultiHopDiscovery } from './discovery/multiHopDiscovery';
import { seedStockholmVenues, getSeedStatus } from './discovery/stockholmSeeding';
import { isSmokeTestMode, runSmokeTest } from './smokeTest';
import { runSmokeTest as runSmokeTestRunner } from './smokeRunner';

// Check for smoke test mode
const SMOKE_MODE = isSmokeTestMode();

async function runSources() {
  console.log('[ingestion] Running source scrapers...');
  
  // Priority order: curated first, then aggregators, then individual sources
  const sources = [
    { name: 'stockholm', fn: scrapeStockholm, priority: 1 },
    { name: 'kulturhuset', fn: runKulturhusetSource, priority: 2 },
    { name: 'ticketmaster', fn: scrapeTicketmaster, priority: 3 },
    { name: 'eventbrite', fn: scrapeEventbrite, priority: 4 },
    { name: 'billetto', fn: scrapeBilletto, priority: 5 },
  ];
  
  // Sort by priority (Stockholm first)
  sources.sort((a, b) => a.priority - b.priority);
  console.log(`[ingestion] Source order: ${sources.map(s => s.name).join(', ')}`);

  const results = await Promise.allSettled(
    sources.map((s) => s.fn())
  );

  // Detailed status reporting per source
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;
  
  sources.forEach((s, i) => {
    if (results[i].status === 'fulfilled') {
      const status = results[i].value;
      if (status === 'skipped') {
        skipCount++;
        console.log(`[ingestion] ⏭️ ${s.name} skipped`);
      } else {
        successCount++;
        console.log(`[ingestion] ✅ ${s.name} completed`);
      }
    } else {
      failCount++;
      const reason = (results[i] as PromiseRejectedResult).reason;
      console.error(`[ingestion] ❌ ${s.name} failed: ${reason?.message || reason}`);
    }
  });

  console.log(`[ingestion] Summary: ${successCount} succeeded, ${skipCount} skipped, ${failCount} failed`);

  // Fetch next batch of expansion candidates from the queue
  const candidates = await fetchNextExpansionCandidates(5);
  if (candidates.length > 0) {
    console.log('[ingestion] Next expansion candidates:');
    for (const c of candidates) {
      console.log(`  - ${c.candidate_name} (${c.city}) priority=${c.priority_score}`);
    }

    // Process expansion batch - this creates results in discovery_expansion_results
    await processExpansionBatch(5);
  }
}

function startNormalizerWorker() {
  const worker = createNormalizerWorker(processRawEvent);

  worker.on('completed', (job) => {
    console.log(`[normalizer] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[normalizer] Job ${job?.id} failed:`, err.message);
  });

  console.log('[normalizer] Worker started');
  return worker;
}

async function main() {
  console.log('[ingestion] EventPulse ingestion service starting...');

  // Check if running in smoke test mode
  if (SMOKE_MODE) {
    console.log('[ingestion] 🚬 SMOKE TEST MODE - Running with limited data');
    console.log('[ingestion]   Use --mode=full for normal ingestion');
    
    // Run smoke test and exit
    try {
      await runSmokeTestRunner();
      console.log('\n[ingestion] ✅ Smoke test completed successfully');
      process.exit(0);
    } catch (err) {
      console.error('[ingestion] ❌ Smoke test failed:', err);
      process.exit(1);
    }
  }

  // Initialize Meilisearch index settings (if configured)
  await initSearchIndex();

  // Seed Stockholm venues for discovery ranking
  console.log('[ingestion] Seeding Stockholm venues...');
  const seededCount = await seedStockholmVenues();
  console.log(`[ingestion] Seeded ${seededCount} Stockholm venues`);

  // Show seed status
  const status = await getSeedStatus();
  console.log(`[ingestion] Discovery status: ${status.total} total, ${status.stockholm} Stockholm, ${status.seeded} seeded`);

  // Start the normalizer worker
  startNormalizerWorker();

  // Start the search sync worker (only if Meilisearch is configured)
  if (isMeilisearchConfigured()) {
    startSearchWorker();
  } else {
    console.warn('[ingestion] Meilisearch not configured, search worker disabled');
  }

  // Run immediately on startup
  await runSources();

  // Schedule: every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    await runSources();
  });

  console.log('[ingestion] Scheduler running. Scraping every 30 minutes.');

  // Log expansion queue stats periodically
  setInterval(async () => {
    const stats = await getQueueStats();
    console.log(`[ingestion] Expansion queue: ${stats.pending} pending, ${stats.processing} processing, ${stats.expanded} expanded`);
  }, 5 * 60 * 1000); // Every 5 minutes

  // Run multi-hop discovery periodically (every 30 minutes)
  setInterval(async () => {
    console.log('[ingestion] Running multi-hop discovery...');
    await runMultiHopDiscovery();
  }, 30 * 60 * 1000);
}

main().catch((err) => {
  console.error('[ingestion] Fatal error:', err);
  process.exit(1);
});
