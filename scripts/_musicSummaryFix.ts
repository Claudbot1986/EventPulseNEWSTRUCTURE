/**
 * _musicSummaryFix.ts — 2026-10-13.
 *
 * Riktad fix för music-events som saknar eventpulse_summary och
 * editorial_description. Använder venue + raw_description-patterns för att
 * bygga en deterministisk summary (ingen LLM).
 *
 * Arkitektur:
 *   - Deterministiskt template eventpulseSummary bygger från
 *     title+category_slug+venue_full_name+venue_city+start_time.
 *   - Om artist kan extraheras från raw_description (entityExtractor
 *     description-patterns), inkluderas i summary.
 *   - Om profile saknas: byggs en minimum profile.performers från artist.
 *   - resultatet är unikt per event (olika artist/datum/venue).
 *
 * Säkerhet:
 *   - ALDRIG raw_description som input till M3 (denna kod använder inte M3).
 *   - raw_description används BARA som källa för entitetsextraktion
 *     (entityExtractor description-patterns).
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx scripts/_musicSummaryFix.ts
 */
import { createClient } from '@supabase/supabase-js';
import {
  buildEventpulseFacts,
  buildEventpulseSummary,
  type EventpulseFactsInput,
} from '../04-Normalizer/eventpulseSummary';
import { extractEntities } from '../04-Normalizer/editorial/entityExtractor';

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
  source: string | null;
  raw_description: string | null;
}

async function main(): Promise<void> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const now = new Date().toISOString();

  // Hämta music-events utan vare sig summary eller editorial_description
  const PAGE = 500;
  const all: DbEvent[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('events')
      .select(`
        id, title_sv, title_en, category_slug, venue_full_name, venue_city,
        start_time, is_free, price_min_sek, source, raw_description
      `)
      .eq('category_slug', 'music')
      .gt('start_time', now)
      .or('eventpulse_summary.is.null,eventpulse_summary.eq.')
      .is('editorial_description', null)
      .range(from, from + PAGE - 1);
    if (error) { console.error('Fel:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...(data as DbEvent[]));
    if (data.length < PAGE) break;
  }

  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`  Music Summary Fix — ${all.length} events utan description`);
  console.log(`════════════════════════════════════════════════════════════`);

  let fixed = 0, skipped = 0, failed = 0;
  for (const ev of all) {
    const title = ev.title_sv || ev.title_en || '';
    if (!title || !ev.start_time) { skipped++; continue; }

    // 1. Hitta artist från raw_description om tillgänglig
    let artist: string | null = null;
    if (ev.raw_description) {
      const entities = extractEntities({
        title,
        raw_description: ev.raw_description,
        category_slug: 'music',
        venue_name: ev.venue_full_name,
      });
      const perfEntity = entities.find(
        (e) => ['artist', 'ensemble', 'band', 'performer'].includes(e.role),
      );
      if (perfEntity) artist = perfEntity.name;
    }

    // 2. Bygg eventpulseSummary-input
    const input: EventpulseFactsInput = {
      title,
      category_slug: 'music',
      venue_name: ev.venue_full_name,
      city: ev.venue_city,
      start_time: ev.start_time,
      is_free: ev.is_free,
      price_min_sek: ev.price_min_sek,
      source: ev.source,
      raw_description: ev.raw_description,
      performers: artist ? [artist] : [],
      city_is_stockholm: (ev.venue_city ?? '').toLowerCase().includes('stockholm'),
    };

    // 3. Bygg deterministisk summary
    const result = buildEventpulseFacts(input);
    const summary = buildEventpulseSummary(result.facts);
    if (!summary) { skipped++; continue; }

    // 4. Spara i DB (eventpulse_summary)
    const { error } = await supabase
      .from('events')
      .update({ eventpulse_summary: summary })
      .eq('id', ev.id);
    if (error) { failed++; continue; }
    fixed++;
  }

  console.log(`\n  Resultat:`);
  console.log(`    ✓ Fixade: ${fixed}`);
  console.log(`    – Skippade: ${skipped} (saknar artist + venue)`);
  console.log(`    ✗ Fel: ${failed}`);
  console.log(`════════════════════════════════════════════════════════════`);
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
