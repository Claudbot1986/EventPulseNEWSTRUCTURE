/**
 * Smoke Test Configuration
 * Provides limited event processing for quick verification of the ingestion pipeline
 * 
 * Usage: npm run dev -- --mode=smoke
 */

import type { RawEventInput } from '@eventpulse/shared';

// Configuration constants - UPDATED: MAX 3 per organizer, 25 safeguard total
export const SMOKE_TEST_CONFIG = {
  // Maximum events per venue/arranger group (KEY CONSTRAINT)
  MAX_EVENTS_PER_ORGANIZER: 3,
  
  // Maximum total events per source (safety guard)
  MAX_EVENTS_PER_SOURCE: 25,
  
  // Queue name for smoke test events
  QUEUE_NAME: 'ingestion_smoke',
  
  // Concurrency for normalizer in smoke test
  CONCURRENCY: 3,
};

/**
 * Get organizer key for grouping events
 * Priority: venue_id → venue_name → organizer/promoter → source (fallback)
 */
function getOrganizerKey(event: any, source: string): string {
  // 1. venue_id from raw_data if available
  if (event.raw_data?.venue_id) {
    return `venue_id:${event.raw_data.venue_id}`;
  }
  
  // 2. venue_name
  if (event.venue_name || event.venue) {
    return `venue:${event.venue_name || event.venue}`;
  }
  
  // 3. organizer or promoter
  if (event.organizer || event.promoter) {
    return `org:${event.organizer || event.promoter}`;
  }
  
  // 4. Fallback to source (ensures ALL sources are tested)
  return `source:${source}`;
}

/**
 * Event limiter - limits events per organizer/venue/group
 * 
 * Groups events by organizer (venue_id → venue_name → organizer → source)
 * Takes only first N events per group
 * Applies total safeguard limit per source
 */
export function limitEventsPerOrganizer(
  events: any[],
  source: string,
  maxPerOrganizer: number = SMOKE_TEST_CONFIG.MAX_EVENTS_PER_ORGANIZER,
  maxTotal: number = SMOKE_TEST_CONFIG.MAX_EVENTS_PER_SOURCE
): { limited: any[]; groupStats: Map<string, number> } {
  const organizerGroups = new Map<string, any[]>();
  
  // Group events by organizer key
  for (const event of events) {
    const key = getOrganizerKey(event, source);
    if (!organizerGroups.has(key)) {
      organizerGroups.set(key, []);
    }
    organizerGroups.get(key)!.push(event);
  }
  
  // Take first N from each group
  const limited: any[] = [];
  const groupStats = new Map<string, number>();
  
  for (const [key, orgEvents] of organizerGroups) {
    const orgLimited = orgEvents.slice(0, maxPerOrganizer);
    limited.push(...orgLimited);
    groupStats.set(key, orgEvents.length);
  }
  
  // Apply total safeguard limit
  let wasLimited = false;
  if (limited.length > maxTotal) {
    limited.length = maxTotal; // Truncate to max
    wasLimited = true;
  }
  
  return { limited, groupStats };
}

/**
 * Format group statistics for logging
 */
export function formatGroupStats(groupStats: Map<string, number>, maxPerOrganizer: number): string {
  const lines: string[] = [];
  
  for (const [key, count] of groupStats) {
    if (count > maxPerOrganizer) {
      lines.push(`  ${key}: ${count} → ${maxPerOrganizer} events`);
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : '  (all groups ≤ ' + maxPerOrganizer + ')';
}

/**
 * Check if running in smoke test mode
 */
export function isSmokeTestMode(): boolean {
  return process.argv.includes('--mode=smoke') || process.argv.includes('--smoke');
}

/**
 * Format smoke test summary
 */
export function formatSmokeTestSummary(results: {
  source: string;
  fetched: number;
  afterLimit: number;
  queued: number;
  normalized: number;
  upserted: number;
  errors: string[];
}[]): string {
  const lines: string[] = [];
  lines.push('\n╔════════════════════════════════════════════════════════════════════════════╗');
  lines.push('║                        SMOKE TEST RESULTS                                ║');
  lines.push('╠═══════════════════╦══════════╦═══════════╦═══════════╦════════╦════════╣');
  lines.push('║ Source             ║ Fetched  ║  Limit    ║  Queued   ║  Norm   ║ Upsert ║');
  lines.push('╠═══════════════════╬══════════╬═══════════╬═══════════╬════════╬════════╣');
  
  let totalFetched = 0;
  let totalAfterLimit = 0;
  let totalQueued = 0;
  let totalNormalized = 0;
  let totalUpserted = 0;
  
  for (const r of results) {
    const name = r.source.padEnd(17).slice(0, 17);
    const status = r.errors.length > 0 ? '⚠️' : '✓';
    lines.push(
      `║ ${name} ║ ${String(r.fetched).padStart(8)} ║ ${String(r.afterLimit).padStart(7)} ║ ${String(r.queued).padStart(7)} ║ ${String(r.normalized).padStart(6)} ║ ${String(r.upserted).padStart(6)} ║`
    );
    totalFetched += r.fetched;
    totalAfterLimit += r.afterLimit;
    totalQueued += r.queued;
    totalNormalized += r.normalized;
    totalUpserted += r.upserted;
  }
  
  lines.push('╠═══════════════════╬══════════╬═══════════╬═══════════╬════════╬════════╣');
  lines.push(`║ TOTALS            ║ ${String(totalFetched).padStart(8)} ║ ${String(totalAfterLimit).padStart(7)} ║ ${String(totalQueued).padStart(7)} ║ ${String(totalNormalized).padStart(6)} ║ ${String(totalUpserted).padStart(6)} ║`);
  lines.push('╚═══════════════════╩══════════╩═══════════╩═══════════╩════════╩════════╝');
  
  // Drop-off analysis
  lines.push('\n📊 Drop-off Analysis:');
  for (const r of results) {
    if (r.fetched > 0) {
      const dropFetchToLimit = r.fetched - r.afterLimit;
      const dropLimitToQueued = r.afterLimit - r.queued;
      const dropQueueToNorm = r.queued - r.normalized;
      const dropNormToUpsert = r.normalized - r.upserted;
      
      lines.push(`  ${r.source}:`);
      if (dropFetchToLimit > 0) lines.push(`    fetched→limit: -${dropFetchToLimit} (${((dropFetchToLimit/r.fetched)*100).toFixed(0)}%)`);
      if (dropLimitToQueued > 0) lines.push(`    limit→queued: -${dropLimitToQueued}`);
      if (dropQueueToNorm > 0) lines.push(`    queued→norm: -${dropQueueToNorm}`);
      if (dropNormToUpsert > 0) lines.push(`    norm→upsert: -${dropNormToUpsert}`);
      if (r.errors.length > 0) lines.push(`    errors: ${r.errors.length}`);
    }
  }
  
  return lines.join('\n');
}
