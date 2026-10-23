/**
 * 07-Discovery/src/sourceTesting/backfillCandidateCities.ts
 *
 * Backfyller source_candidates.city för rader som redan finns, efter att
 * migration 20261021-0003 lade till kolumnen. Nyfödda rader får city direkt
 * från respektive producent — det här är bara för de 419 som redan ligger där.
 *
 * Staden härleds per engine, inte gissas:
 *   venue_graph_geo  → centroid_lat/lng mot CITY_BOUNDS (geoExpansion:s box)
 *   exa_search /
 *   google_cse       → stad för source_query (discoverySearch:s frågelista)
 *   rss_discovery    → city i sources/<sourceId>.jsonl
 *
 * Rad som inte kan härledas får NULL. NULL betyder "vet inte" och filtreras
 * bort av isInScope() — det är avsiktligt hellre än ett gissat Stockholm.
 *
 * Usage:
 *   npx tsx 07-Discovery/src/sourceTesting/backfillCandidateCities.ts --dry-run
 *   npx tsx 07-Discovery/src/sourceTesting/backfillCandidateCities.ts
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { CITY_BOUNDS } from '../venueGraph/geoExpansion.js';
import { cityForDiscoveryQuery } from '../searchEngines/discoverySearch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: true });

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const dryRun = process.argv.includes('--dry-run');
const defaultCity = argValue('--city') ?? 'Stockholm';

interface CandidateRow {
  id: string;
  engine: string;
  source_query: string | null;
  city: string | null;
  metadata: Record<string, unknown> | null;
}

function cityInBounds(lat: unknown, lng: unknown, city: string): string | null {
  const bounds = CITY_BOUNDS[city];
  if (!bounds) return null;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const inside =
    lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
  return inside ? city : null;
}

function cityFromSourcesFile(sourceId: string): string | null {
  const sourcePath = path.join(PROJECT_ROOT, 'sources', `${sourceId}.jsonl`);
  if (!existsSync(sourcePath)) return null;
  try {
    const record = JSON.parse(readFileSync(sourcePath, 'utf8').trim());
    return typeof record.city === 'string' && record.city.trim() ? record.city.trim() : null;
  } catch {
    return null;
  }
}

function deriveCity(row: CandidateRow, city: string): string | null {
  if (row.engine === 'venue_graph_geo') {
    return cityInBounds(row.metadata?.centroid_lat, row.metadata?.centroid_lng, city);
  }
  if (row.engine === 'exa_search' || row.engine === 'google_cse') {
    return row.source_query ? cityForDiscoveryQuery(row.source_query) : null;
  }
  if (row.engine === 'rss_discovery') {
    const sourceId = row.source_query?.startsWith('rss:') ? row.source_query.slice(4) : null;
    return sourceId ? cityFromSourcesFile(sourceId) : null;
  }
  return null;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db
    .from('source_candidates')
    .select('id,engine,source_query,city,metadata')
    .limit(5000);
  if (error) throw error;

  const rows = (data ?? []) as CandidateRow[];
  const byEngine: Record<string, Record<string, number>> = {};
  const updates: { id: string; city: string | null }[] = [];

  for (const row of rows) {
    const bucket = (byEngine[row.engine] ??= {});
    const derived = deriveCity(row, defaultCity);
    const label = derived ?? row.city ?? 'unknown';
    bucket[label] = (bucket[label] ?? 0) + 1;
    // En känd stad får aldrig skrivas över med "vet inte". P3A sätter city direkt
    // från frågan som hittade URL:en; source_query i de raderna är den
    // sammanslagna frågelistan och härleder inget (2026-10-21).
    if (row.city !== null && derived === null) continue;
    if (derived !== row.city) updates.push({ id: row.id, city: derived });
  }

  console.log(JSON.stringify({ dryRun, total: rows.length, byEngine, toUpdate: updates.length }, null, 2));
  if (dryRun) return;

  // PostgREST upsert krävs conflict-target; gör en enkel patch per rad i
  // klumpar av 50 så vi inte skickar 419 anrop i en burst.
  const BATCH = 50;
  let applied = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map((u) =>
        db.from('source_candidates').update({ city: u.city }).eq('id', u.id).select('id'),
      ),
    );
    const failed = results.filter((r) => r.error);
    if (failed.length > 0) {
      console.error(`batch ${i / BATCH} had ${failed.length} errors: ${failed[0].error?.message}`);
      process.exitCode = 1;
      return;
    }
    applied += chunk.length;
  }
  console.log(`applied ${applied} city updates`);

  // Kötabellen bär en kopia. Migration 0003:s synk kördes före den här
  // backfillen, så kör den igen — annars claimar P3D köer med city=null.
  const { error: syncErr } = await db.rpc('sync_source_candidate_queue_city' as never);
  if (syncErr) {
    console.error(`queue sync failed: ${syncErr.message}`);
    process.exitCode = 1;
    return;
  }
  console.log('queue city synced');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});