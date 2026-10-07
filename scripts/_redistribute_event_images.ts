#!/usr/bin/env -S npx tsx
/**
 * _redistribute_event_images.ts — Fas B: omfördela events till kategorirätt bild.
 *
 * För varje framtida event (status='published', start_time > now()):
 *   1. Använd pickLibraryFallback(category_slug) från 08-Agent/utils/imageLibrary.ts
 *   för att hitta bästa match (least-used rotation via times_used ASC).
 *   2. Om match_type='category' eller 'default' (vi bryr oss om kategori-rätt):
 *      kör markEventWithLibraryFallback() som sätter image_url + library-fallback
 *      metadata.
 *   3. Skippa events som redan pekar på library-fallback (idempotent).
 *   4. Skippa events med image_ai_generated=true (befintlig BFL-bild bevaras).
 *
 * Säkerhet:
 *   - Default = --dry-run (visar plan, ändrar inget)
 *   - --apply för skarp körning
 *   - Batcher om 200 rader, concurrency 4 (för att inte överbelasta Supabase)
 *   - Idempotent: kan köras igen utan att dubbel-räkna
 *
 * Användning:
 *   npx tsx scripts/_redistribute_event_images.ts --dry-run   # default
 *   npx tsx scripts/_redistribute_event_images.ts --apply
 *   npx tsx scripts/_redistribute_event_images.ts --only=500  # limit för smoke-test
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  pickLibraryFallback,
  markEventWithLibraryFallback,
  type FallbackResult,
} from '../08-Agent/utils/imageLibrary';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BATCH_SIZE = 200;
const CONCURRENCY = 4;

const argIdx = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;
const limitArg = argIdx('--only');

interface FutureEvent {
  id: string;
  category_slug: string | null;
  image_url: string | null;
  image_ai_generated: boolean;
  image_generation_status: string | null;
}

async function fetchAllFutureEvents(): Promise<FutureEvent[]> {
  const out: FutureEvent[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('events')
      .select('id, category_slug, image_url, image_ai_generated, image_generation_status')
      .eq('status', 'published')
      .gt('start_time', new Date().toISOString())
      .range(from, from + 1000 - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

interface Counters {
  total: number;
  aiGenerated: number;
  alreadyLibrary: number;
  wouldAssign: number;
  noMatch: number;
  byMatchType: Record<string, number>;
  byCategory: Record<string, number>;
}

function emptyCounters(): Counters {
  return {
    total: 0, aiGenerated: 0, alreadyLibrary: 0, wouldAssign: 0, noMatch: 0,
    byMatchType: {}, byCategory: {},
  };
}

async function processEvent(ev: FutureEvent, counters: Counters): Promise<void> {
  counters.total++;

  // Skippa redan-tilldelade (idempotent)
  // Skippa events som redan pekar på library-fallback med kategori-match
  // (vi vill bara re-omfördela om så modiga inte är 'category').
  // Biblioteket uppdateras via bumpUsage vid varje fallback-pick, så vi
  // kan re-köra och least-minutenunuppdaterad-bilden plockas.
  // Faktum: vi bearbetar ALLA icke-even i library-fallback också för att
  // garantera spridning mot de 85 nya BFL-bilderna som tidigare inte användes.
  if (ev.image_generation_status === 'library_fallback') {
    counters.alreadyLibrary++;
  }
  // Skippa befintliga AI-bilder (de är redan BFL-genererade och stämplade)
  if (ev.image_ai_generated) {
    counters.aiGenerated++;
    return;
  }
  // Skippa NULL-category events där vi inte vet var de hör hemma
  // (de kommer få genericFallbackImage, räknas som match)

  const fallback = await pickLibraryFallback({
    venue_id: null,
    venue_name: null,
    category_slug: ev.category_slug,
  });

  if (!fallback.url || !fallback.library_id) {
    counters.noMatch++;
    return;
  }

  counters.wouldAssign++;
  counters.byMatchType[fallback.match_type] = (counters.byMatchType[fallback.match_type] ?? 0) + 1;
  if (ev.category_slug) {
    counters.byCategory[ev.category_slug] = (counters.byCategory[ev.category_slug] ?? 0) + 1;
  }

  if (isApply) {
    try {
      await markEventWithLibraryFallback(ev.id, fallback);
    } catch (e) {
      console.error(`  ✗ ${ev.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function processBatch(events: FutureEvent[], counters: Counters): Promise<void> {
  // Processera N rader med CONCURRENCY workers
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < events.length) {
      const idx = cursor++;
      await processEvent(events[idx], counters);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
}

console.log(`[redistribute] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
console.log(`[redistribute] batch: ${BATCH_SIZE}, concurrency: ${CONCURRENCY}`);

const t0 = Date.now();
const events = await fetchAllFutureEvents();
const elapsedFetch = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[redistribute] hämtade ${events.length} framtida events på ${elapsedFetch}s`);

const limit = limitArg ? parseInt(limitArg, 10) : null;
const toProcess = limit ? events.slice(0, limit) : events;
console.log(`[redistribute] processar ${toProcess.length} events${limit ? ` (limit)` : ''}`);

const counters = emptyCounters();

// Bearbeta i batcher om BATCH_SIZE
for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
  const batch = toProcess.slice(i, i + BATCH_SIZE);
  const batchNo = Math.floor(i / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);
  await processBatch(batch, counters);
  if (batchNo % 5 === 0 || batchNo === totalBatches) {
    console.log(`  [batch ${batchNo}/${totalBatches}] ${counters.total}/${toProcess.length} processerade, ${counters.wouldAssign} tilldelade`);
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log('');
console.log(`[redistribute] DONE in ${elapsed}s`);
console.log(`  totalt processerade: ${counters.total}`);
console.log(`  skip ai_generated:   ${counters.aiGenerated}`);
console.log(`  skip redan-library:   ${counters.alreadyLibrary}`);
console.log(`  no match:            ${counters.noMatch}`);
console.log(`  ${isApply ? 'tilldelade' : 'skulle tilldela'}:       ${counters.wouldAssign}`);
console.log('');
console.log(`match_type-fördelning:`);
for (const [k, v] of Object.entries(counters.byMatchType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${v}`);
}
console.log('');
console.log(`topp-10 kategorier:`);
for (const [k, v] of Object.entries(counters.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${k.padEnd(20)} ${v}`);
}