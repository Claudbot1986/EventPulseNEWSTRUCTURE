/**
 * _updateEditorialTid.ts — FAS 5.3 2026-10-14.
 *
 * Uppdaterar editorial_description för ALLA icke-musik events med ny
 * FACT-template som inkluderar Tid (HH:MM).
 *
 * Bakgrund: verifiering visade 76.4% unikhet på 8 309 editorial_description.
 * 351 theatre-drama-events hade identisk text pga tom title_sv.
 * Tid-fältet separerar events med samma datum men olika tider.
 *
 * Säkerhet:
 *   - Inget LLM, ingen M3 — bara deterministisk FACT-template.
 *   - Uppdaterar BARA editorial_description, inte andra fält.
 *   - Backup-script: _restoreEditorialTid.ts kan återställa.
 */
import { createClient } from '@supabase/supabase-js';
import { buildEventProfile, type EventUnderstandingInput } from './eventUnderstanding';
import { chooseFallback } from './fallbackHierarchy';
import type { EventProfile } from './types';

interface DbEvent {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  category_slug: string | null;
  venue_full_name: string | null;
  venue_city: string | null;
  start_time: string | null;
  is_free: boolean | null;
  price_min_sek: number | null;
  event_profile: { profile: EventProfile; version: number; generated_at: string } | null;
}

const EXCLUDED_CATEGORIES = [
  'music', 'rock', 'pop', 'jazz', 'electronic', 'hip-hop', 'classical', 'musical-theatre',
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const catArg = args.find((a) => a.startsWith('--category='));
  const onlyCategory = catArg ? catArg.slice('--category='.length) : undefined;

  console.log('═'.repeat(70));
  console.log(`  UPDATE editorial_description med Tid-fält`);
  console.log(`  Mode: ${dryRun ? 'DRY-RUN' : 'PROD'} | Category: ${onlyCategory ?? 'alla icke-musik'}`);
  console.log('═'.repeat(70));

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Hämta alla events med editorial_description
  const now = new Date().toISOString();
  const PAGE = 1000;
  const all: DbEvent[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('events')
      .select(`
        id, title_sv, title_en, category_slug, venue_full_name, venue_city,
        start_time, is_free, price_min_sek, event_profile
      `)
      .gt('start_time', now)
      .not('editorial_description', 'is', null)
      .order('start_time', { ascending: true })
      .range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    let filtered = data as DbEvent[];
    if (onlyCategory) {
      filtered = filtered.filter(e => e.category_slug === onlyCategory);
    } else {
      filtered = filtered.filter(e => !EXCLUDED_CATEGORIES.includes(e.category_slug ?? ''));
    }
    all.push(...filtered);
    if (data.length < PAGE) break;
  }
  console.log(`\n  Hittade ${all.length} events att uppdatera.\n`);
  if (all.length === 0) { console.log('  Inget att göra.'); return; }

  let updated = 0;
  let failed = 0;
  const BATCH = 100;
  const updates: { id: string; text: string }[] = [];

  for (const ev of all) {
    if (!ev.event_profile || !ev.start_time) continue;
    const title = ev.title_sv || ev.title_en || '';
    if (!title) continue;
    const eventInput: EventUnderstandingInput = {
      title,
      category_slug: ev.category_slug,
      venue_name: ev.venue_full_name,
      city: ev.venue_city,
      start_time: ev.start_time,
      is_free: ev.is_free ?? false,
      price_min_sek: ev.price_min_sek,
      language: null,
      performers: Object.keys(ev.event_profile.profile.performer_metadata ?? {}),
      source: 'eventpulse-update-tid',
    };
    const profile = buildEventProfile(eventInput);
    const fallback = chooseFallback(profile, eventInput);
    if (!fallback.level) continue;
    updates.push({ id: ev.id, text: fallback.text });
  }
  console.log(`  ${updates.length} nya description-strängar att skriva.\n`);

  if (dryRun) {
    console.log('  DRY-RUN — inga DB-ändringar. Sample (3):');
    for (const u of updates.slice(0, 3)) console.log(`    ${u.text}`);
    return;
  }

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    // Parallella UPDATE via Promise.all
    const results = await Promise.all(batch.map(async (u) => {
      const { error } = await supabase
        .from('events')
        .update({ editorial_description: u.text })
        .eq('id', u.id);
      return error ? 0 : 1;
    }));
    updated += results.reduce((s, r) => s + r, 0);
    failed += batch.length - results.reduce((s, r) => s + r, 0);
    if ((i + BATCH) % 500 === 0 || i + BATCH >= updates.length) {
      process.stdout.write(`\r  [${Math.min(i + BATCH, updates.length)}/${updates.length}] uppdaterade=${updated} fel=${failed}`);
    }
  }
  console.log(`\n\n  Klart: ${updated} uppdaterade, ${failed} fel av ${updates.length}`);
  console.log('═'.repeat(70));
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
