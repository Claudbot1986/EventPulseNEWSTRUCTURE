/**
 * Unified Source Runner - Coordinates all non-Ticketmaster sources
 * Can run individually or alongside main ingestion
 */

import { runAllSources, printSourceSummary, type SourceResult } from './sourceAdapters';

export { runAllSources, printSourceSummary };
export type { SourceResult } from './sourceAdapters';

/**
 * Run sources by method type
 */
export async function runByMethod(method: 'wordpress' | 'json-ld' | 'api' | 'elasticsearch' | 'html' | 'all'): Promise<SourceResult[]> {
  console.log(`[runner] Running sources for method: ${method}`);
  
  const allResults = await runAllSources();
  
  if (method === 'all') {
    return allResults;
  }
  
  return allResults.filter(r => r.method === method);
}

/**
 * Run sources by name
 */
export async function runByName(names: string[]): Promise<SourceResult[]> {
  console.log(`[runner] Running specific sources: ${names.join(', ')}`);
  
  const allResults = await runAllSources();
  return allResults.filter(r => names.includes(r.source));
}

/**
 * Run sources and filter by status
 */
export async function runWithFilter(
  filter: (r: SourceResult) => boolean
): Promise<SourceResult[]> {
  const allResults = await runAllSources();
  return allResults.filter(filter);
}

/**
 * Get successful sources only
 */
export async function getWorkingSources(): Promise<SourceResult[]> {
  return runWithFilter(r => r.status === 'success');
}

/**
 * Get failed sources for debugging
 */
export async function getFailedSources(): Promise<SourceResult[]> {
  return runWithFilter(r => r.status === 'fail');
}

/**
 * Get sources with events but not queued
 */
export async function getPartialSources(): Promise<SourceResult[]> {
  return runWithFilter(r => r.status === 'partial');
}
