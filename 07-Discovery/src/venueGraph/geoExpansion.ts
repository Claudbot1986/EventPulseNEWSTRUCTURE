/**
 * 07-Discovery/src/venueGraph/geoExpansion.ts
 *
 * P3B (2026-09-10): Geografisk grann-sökning för venue-graph.
 *
 * Vad: hittar venues i Stockholm som ligger inom 500m av varandra
 * (default radius, --geo-radius-m) och skapar venue_candidates för
 * discovery (Exa-query per kluster).
 *
 * Hur:
 *   1. Hämta alla venues med lat/lng från Supabase.
 *   2. Klustra via single-linkage: två venues i samma kluster om
 *      haversine-avstånd ≤ radius.
 *   3. För kluster med ≥2 venues: beräkna centroid + skapa en
 *      source_candidate med en geo-query som triggar Exa.
 *   4. Skriv till source_candidates-tabellen (engine='venue_graph_geo').
 *
 * Vetenskaplig bas:
 *   - Single-linkage clustering (Sneath 1957) — enklaste form av
 *     hierarkisk klustring; O(n²) passar <1000 venues.
 *   - Haversine-formel (Sinnott 1984) för avstånd på sfär.
 *   - Discovery via geo-query ("events near ${centroid}") — se
 *     Backstrom et al. 2008 "Spatial Variation in Search Engine Queries"
 *     som visar att geo-modifierade queries ökar lokal precision.
 *
 * Säkerhet:
 *   - Vi rör ALDRIG `venues`-tabellen (read-only).
 *   - Vi skriver BARA nya rader i `source_candidates` (upsert på url).
 *   - Default-radius 500m ger typiskt 3–8 venues per kluster i Stockholm.
 *
 * Usage:
 *   import { run } from './geoExpansion.js';
 *   const r = await run({ radiusMeters: 500, limit: 50, dryRun: true });
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: true });

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }
  return _supabase;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface GeoExpansionOptions {
  /** Kluster-radie i meter (default 500). */
  radiusMeters?: number;
  /** Max antal kluster att skriva (default 50). */
  limit?: number;
  /** Dry-run: räkna men skriv inte. Default false. */
  dryRun?: boolean;
  /** Filter till specifik stad (default 'Stockholm'). */
  city?: string;
}

export interface VenuePoint {
  id: string;
  name: string;
  city: string | null;
  lat: number;
  lng: number;
}

export interface GeoCluster {
  /** Centroid lat/lng (medel av klustrets venues). */
  centroidLat: number;
  centroidLng: number;
  /** Antal venues i klustret. */
  size: number;
  /** Lista över venue-IDs som ingår. */
  venueIds: string[];
  /** Namn på största venue-namnet (för query-text). */
  representativeName: string;
  /** Stad. */
  city: string | null;
}

export interface GeoExpansionResult {
  radiusMeters: number;
  totalVenuesWithCoords: number;
  clustersFound: number;
  clustersWritten: number;
  dryRun: boolean;
  firstError: string | null;
  /** Klustren som hittades (även de som inte skrevs p.g.a. limit). */
  topClusters: Array<{ size: number; representativeName: string; lat: number; lng: number }>;
}

// ── Geo math ──────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine-avstånd mellan två punkter (i meter). */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// ── Single-linkage clustering ──────────────────────────────────────────────

function clusterByProximity(points: VenuePoint[], radiusMeters: number): GeoCluster[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, parent.get(next)!); // path compression
      cur = parent.get(cur)!;
    }
    return cur;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const p of points) parent.set(p.id, p.id);

  // O(n²) — OK för <1000 venues (Stockholm totalt ~500 venues just nu).
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = haversineMeters(points[i], points[j]);
      if (d <= radiusMeters) {
        union(points[i].id, points[j].id);
      }
    }
  }

  // Samla kluster
  const groups = new Map<string, VenuePoint[]>();
  for (const p of points) {
    const root = find(p.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(p);
  }

  const clusters: GeoCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue; // bara singletons → skip
    const sumLat = members.reduce((s, m) => s + m.lat, 0);
    const sumLng = members.reduce((s, m) => s + m.lng, 0);
    const representative = members.reduce((a, b) => (a.name.length >= b.name.length ? a : b));
    clusters.push({
      centroidLat: sumLat / members.length,
      centroidLng: sumLng / members.length,
      size: members.length,
      venueIds: members.map((m) => m.id),
      representativeName: representative.name,
      city: representative.city,
    });
  }

  // Sortera: störst först (störst kluster = störst chans till discovery-fynd)
  clusters.sort((a, b) => b.size - a.size);
  return clusters;
}

// ── Public entrypoint ─────────────────────────────────────────────────────

export async function run(opts: GeoExpansionOptions = {}): Promise<GeoExpansionResult> {
  const radiusMeters = opts.radiusMeters ?? 500;
  const limit = opts.limit ?? 50;
  const dryRun = opts.dryRun ?? false;
  const cityFilter = opts.city ?? 'Stockholm';

  const result: GeoExpansionResult = {
    radiusMeters,
    totalVenuesWithCoords: 0,
    clustersFound: 0,
    clustersWritten: 0,
    dryRun,
    firstError: null,
    topClusters: [],
  };

  // Hämta venues med koordinater
  const { data: venues, error: fetchErr } = await db()
    .from('venues')
    .select('id,name,city,lat,lng')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .eq('city', cityFilter);

  if (fetchErr) {
    result.firstError = `fetch failed: ${fetchErr.message}`;
    return result;
  }

  if (!venues || venues.length === 0) {
    return result;
  }

  // Filtrera ogiltiga koordinater
  const points: VenuePoint[] = venues
    .filter((v) => typeof v.lat === 'number' && typeof v.lng === 'number' && Number.isFinite(v.lat) && Number.isFinite(v.lng))
    .map((v) => ({
      id: v.id,
      name: v.name,
      city: v.city ?? null,
      lat: v.lat as number,
      lng: v.lng as number,
    }));

  result.totalVenuesWithCoords = points.length;
  if (points.length < 2) {
    return result; // behöver minst 2 venues för klustring
  }

  const clusters = clusterByProximity(points, radiusMeters);
  result.clustersFound = clusters.length;
  result.topClusters = clusters.slice(0, limit).map((c) => ({
    size: c.size,
    representativeName: c.representativeName,
    lat: c.centroidLat,
    lng: c.centroidLng,
  }));

  if (clusters.length === 0 || dryRun) {
    if (dryRun) result.clustersWritten = Math.min(clusters.length, limit);
    return result;
  }

  // Skriv source_candidates för de N största klustren
  const toWrite = clusters.slice(0, limit);
  const rows = toWrite.map((c) => {
    // Geo-query format: "events near ${lat},${lng} ${city}"
    // Använd ~6 decimaler (1dm precision) för att inte läcka mer än nödvändigt.
    const lat = c.centroidLat.toFixed(6);
    const lng = c.centroidLng.toFixed(6);
    const query = `events near ${lat},${lng} ${c.city ?? cityFilter}`;
    // URL = sentinel-URL som discoverySearch kommer att plocka upp via query-text
    // (vi använder geo:-protokollet som placeholder; discoverySearch parsar query-text).
    const url = `geo:${lat},${lng}?q=${encodeURIComponent(query)}`;
    return {
      url,
      source_query: query,
      discovered_at: new Date().toISOString(),
      engine: 'venue_graph_geo',
      status: 'pending',
      metadata: {
        cluster_size: c.size,
        venue_ids: c.venueIds,
        centroid_lat: c.centroidLat,
        centroid_lng: c.centroidLng,
        representative_name: c.representativeName,
        radius_meters: radiusMeters,
      },
    };
  });

  const { error: upsertErr } = await db()
    .from('source_candidates')
    .upsert(rows as never, { onConflict: 'url', ignoreDuplicates: true });

  if (upsertErr) {
    result.firstError = `upsert failed: ${upsertErr.message}`;
    return result;
  }

  result.clustersWritten = rows.length;
  return result;
}

// ── CLI wrapper ───────────────────────────────────────────────────────────

import { fileURLToPath } from 'url';

const cliArgs = process.argv.slice(2);
const radiusIdx = cliArgs.indexOf('--geo-radius-m');
const limitIdx = cliArgs.indexOf('--limit');
const cityIdx = cliArgs.indexOf('--city');
const dryRunFlag = cliArgs.includes('--dry-run');

const radiusMeters = radiusIdx !== -1 ? parseInt(cliArgs[radiusIdx + 1], 10) : 500;
const limit = limitIdx !== -1 ? parseInt(cliArgs[limitIdx + 1], 10) : 50;
const city = cityIdx !== -1 ? cliArgs[cityIdx + 1] : 'Stockholm';

const isMainModule = (() => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return process.argv[1] === __filename || process.argv[1]?.endsWith('geoExpansion.ts');
  } catch {
    return false;
  }
})();

if (isMainModule && cliArgs.length > 0) {
  run({ radiusMeters, limit, city, dryRun: dryRunFlag })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.firstError ? 1 : 0);
    })
    .catch((e) => {
      console.error('[geoExpansion] FATAL:', e);
      process.exit(1);
    });
}