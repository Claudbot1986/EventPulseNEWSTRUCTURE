/**
 * Smoke Test Runner
 * Runs all sources with limited data for quick verification
 * 
 * Usage: npm run dev -- --mode=smoke
 * 
 * Constraints:
 * - MAX 3 events per organizer/venue
 * - MAX 25 events per source (safeguard)
 * - Separate queue for isolation
 */

import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import { scrapeTicketmaster } from './sources/ticketmaster';
import { scrapeEventbrite } from './sources/eventbrite';
import { scrapeBilletto } from './sources/billetto';
import { fetchKulturhusetEvents } from './sources/kulturhuset';
import { fetchDebaserEvents } from './sources/debaser';
import { fetchKulturhusetBarnUngEvents } from './sources/kulturhusetBarnUng';
import { createSmokeTestWorker, smokeTestQueue, clearSmokeTestQueue } from './queue';
import { processRawEvent } from './normalizer';
import { SMOKE_TEST_CONFIG, limitEventsPerOrganizer, formatSmokeTestSummary } from './smokeTest';
import type { RawEventInput } from '@eventpulse/shared';

interface SmokeTestResult {
  source: string;
  fetched: number;
  afterLimit: number;
  queued: number;
  normalized: number;
  upserted: number;
  errors: string[];
}

// Map event to RawEventInput format
function mapToRawEventInput(event: any, source: string): RawEventInput {
  const fullTimestamp = event.start_time || `${event.date}T${event.time}`;
  
  return {
    source,
    source_id: event.id,
    title: event.title,
    description: event.description || '',
    start_date: event.date,
    start_time: fullTimestamp,
    end_date: event.date,
    end_time: event.time,
    venue_name: event.venue || event.venue_name || '',
    venue_city: event.area || 'Stockholm',
    venue_address: event.address || '',
    venue_lat: event.lat || null,
    venue_lng: event.lng || null,
    category: event.category || 'culture',
    url: event.url || '',
    image_url: event.image_url || event.imageUrl || null,
    price_info: event.price_info || null,
    promoter: event.promoter || null,
    organizer: event.organizer || null,
    accessibility: event.accessibility || null,
    age_restriction: event.age_restriction || null,
    tags: event.tags || [],
    raw_data: event,
  };
}

// Queue events to smoke test queue
async function queueEventsToSmokeTest(
  events: any[],
  source: string
): Promise<{ queued: number; errors: string[] }> {
  let queued = 0;
  const errors: string[] = [];
  
  for (const event of events) {
    try {
      const rawEvent = mapToRawEventInput(event, source);
      const safeJobId = `${source}-${event.id}`.replace(/:/g, '-');
      
      await smokeTestQueue.add('smoke-process', rawEvent, {
        jobId: `smoke-${safeJobId}`,
      });
      queued++;
    } catch (err: any) {
      errors.push(`${event.id}: ${err.message}`);
    }
  }
  
  return { queued, errors };
}

// Run a single source with smoke test limiting
async function runSmokeSource(
  name: string,
  fetchFn: () => Promise<any[]>,
  limitOptions?: { fetchAll?: boolean; limit?: number }
): Promise<SmokeTestResult> {
  console.log(`\n[smoke-test] 🔄 ${name}`);
  
  const result: SmokeTestResult = {
    source: name,
    fetched: 0,
    afterLimit: 0,
    queued: 0,
    normalized: 0,
    upserted: 0,
    errors: [],
  };
  
  try {
    // Fetch events
    let events: any[];
    if (name === 'kulturhuset') {
      // Kulturhuset: fetch first page only for smoke test (max ~100 events)
      events = await fetchKulturhusetEvents({ page: 0, limit: 100 });
    } else if (limitOptions?.limit) {
      events = await fetchFn();
      events = events.slice(0, limitOptions.limit);
    } else {
      events = await fetchFn();
    }
    
    result.fetched = events.length;
    console.log(`[smoke-test]   📥 fetched: ${result.fetched}`);
    
    // Apply organizer-level limiting (MAX 3 per organizer, 25 total safeguard)
    const { limited, groupStats } = limitEventsPerOrganizer(
      events,
      name,
      SMOKE_TEST_CONFIG.MAX_EVENTS_PER_ORGANIZER,
      SMOKE_TEST_CONFIG.MAX_EVENTS_PER_SOURCE
    );
    
    result.afterLimit = limited.length;
    console.log(`[smoke-test]   📊 after smoke limit: ${result.afterLimit}`);
    
    // Log group stats if events were limited
    const limitedGroups = Array.from(groupStats.entries()).filter(([_, count]) => count > SMOKE_TEST_CONFIG.MAX_EVENTS_PER_ORGANIZER);
    if (limitedGroups.length > 0) {
      console.log(`[smoke-test]   📋 Limited groups:`);
      for (const [key, count] of limitedGroups) {
        console.log(`       ${key}: ${count} → ${SMOKE_TEST_CONFIG.MAX_EVENTS_PER_ORGANIZER}`);
      }
    }
    
    // Queue events
    const { queued, errors } = await queueEventsToSmokeTest(limited, name);
    result.queued = queued;
    result.errors = errors;
    console.log(`[smoke-test]   📤 queued: ${result.queued}`);
    
    if (errors.length > 0) {
      console.log(`[smoke-test]   ⚠️ errors: ${errors.length}`);
    }
    
  } catch (err: any) {
    result.errors.push(err.message);
    console.error(`[smoke-test]   ❌ error: ${err.message}`);
  }
  
  return result;
}

// Main smoke test runner
export async function runSmokeTest(): Promise<SmokeTestResult[]> {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║           🚬 EVENTPULSE SMOKE TEST - STARTING                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`[smoke-test] Config: MAX ${SMOKE_TEST_CONFIG.MAX_EVENTS_PER_ORGANIZER} events/organizer, ${SMOKE_TEST_CONFIG.MAX_EVENTS_PER_SOURCE} max/source`);
  
  // Clear any old smoke test jobs
  await clearSmokeTestQueue();
  
  const results: SmokeTestResult[] = [];
  
  // Track normalization counts (will be updated by worker)
  const normalizedCounts = new Map<string, number>();
  const upsertedCounts = new Map<string, number>();
  
  // Start normalizer worker for smoke test queue
  console.log('[smoke-test] Starting smoke test normalizer worker...');
  const worker = createSmokeTestWorker(async (job) => {
    await processRawEvent(job);
    // Track completed jobs
    const data = job.data as RawEventInput;
    normalizedCounts.set(data.source, (normalizedCounts.get(data.source) || 0) + 1);
    upsertedCounts.set(data.source, (upsertedCounts.get(data.source) || 0) + 1);
  });
  
  // Define all sources to run (ALL sources, no exceptions)
  const sources = [
    { name: 'ticketmaster', fn: () => scrapeTicketmaster() },
    { name: 'kulturhuset', fn: () => fetchKulturhusetEvents({ page: 0, limit: 100 }) },
    { name: 'debaser', fn: () => fetchDebaserEvents({ limit: 50 }) },
    { name: 'kulturhuset-barn-ung', fn: () => fetchKulturhusetBarnUngEvents({ limit: 50 }) },
    { name: 'eventbrite', fn: () => scrapeEventbrite() },
    { name: 'billetto', fn: () => scrapeBilletto() },
  ];
  
  // Run each source
  for (const source of sources) {
    const result = await runSmokeSource(source.name, source.fn);
    
    // Add normalization counts
    result.normalized = normalizedCounts.get(source.name) || 0;
    result.upserted = upsertedCounts.get(source.name) || 0;
    
    results.push(result);
    
    // Small delay between sources
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Wait for all queued jobs to be processed
  console.log('\n[smoke-test] Waiting for queue to drain...');
  let maxWait = 30; // 30 seconds max
  let lastCounts = { active: -1, waiting: -1 };
  
  while (maxWait > 0) {
    const counts = await smokeTestQueue.getJobCounts();
    if (counts.active === 0 && counts.waiting === 0) {
      break;
    }
    if (counts.active !== lastCounts.active || counts.waiting !== lastCounts.waiting) {
      console.log(`[smoke-test]   queue: active=${counts.active}, waiting=${counts.waiting}`);
      lastCounts = counts;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    maxWait -= 2;
  }
  
  // Final update of results
  for (const result of results) {
    result.normalized = normalizedCounts.get(result.source) || result.normalized;
    result.upserted = upsertedCounts.get(result.source) || result.upserted;
  }
  
  // Close worker
  await worker.close();
  
  // Print summary
  console.log(formatSmokeTestSummary(results));
  
  // Summary
  const successCount = results.filter(r => r.errors.length === 0).length;
  const totalQueued = results.reduce((sum, r) => sum + r.queued, 0);
  const totalNormalized = results.reduce((sum, r) => sum + r.normalized, 0);
  
  console.log('\n✅ Smoke test complete!');
  console.log(`   Sources run: ${results.length}/${sources.length}`);
  console.log(`   Total queued: ${totalQueued}`);
  console.log(`   Total normalized: ${totalNormalized}`);
  
  return results;
}
