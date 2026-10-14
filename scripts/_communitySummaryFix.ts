/**
 * _communitySummaryFix.ts — 2026-10-14.
 *
 * Riktad fix för community-events som saknar eventpulse_summary.
 * Använder deterministiskt template (ingen LLM) som bygger från
 * title+category_slug+venue_full_name+venue_city+start_time.
 *
 * Bakgrund (Fas 5 / Community-100%, 2026-10-14):
 *   - buildEventpulseSummary returnerade tidigare null för community-events
 *     utan artist+venue. Detta gjorde att ~92 events fick NULL summary.
 *   - Fix i eventpulseSummary.ts: title används som fallback för community.
 *   - Detta script kör backfill på redan-insertade events som fortfarande
 *     har NULL summary.
 *
 * Säkerhet:
 *   - ALDRIG raw_description som input till M3 (denna kod använder inte M3).
 *   - raw_description används BARA som källa för entitetsextraktion
 *     (entityExtractor description-patterns).
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx scripts/_communitySummaryFix.ts
 */
import { createClient } from '@supabase/supabase-js';
import {
  buildEventpulseFacts,
  buildEventpulseSummary,
  type EventpulseFactsInput,
} from '../04-Normalizer/eventpulseSummary';

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

  // Hämta community-events som saknar eventpulse_summary
  const PAGE = 500;
  const all: DbEvent[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('events')
      .select(`
        id, title_sv, title_en, category_slug, venue_full_name, venue_city,
        start_time, is_free, price_min_sek, source, raw_description
      `)
      .eq('category_slug', 'community')
      .gt('start_time', now)
      .is('eventpulse_summary', null)
      .range(from, from + PAGE - 1);
    if (error) { console.error('Fel:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...(data as DbEvent[]));
    if (data.length < PAGE) break;
  }

  console.log('═'.repeat(70));
  console.log(`  Community Summary Fix — ${all.length} events utan description`);
  console.log('═'.repeat(70));

  if (all.length === 0) {
    console.log('  Inget att göra. Alla community-events har summary.');
    return;
  }

  let fixed = 0, skipped = 0, failed = 0;
  for (const ev of all) {
    const title = ev.title_sv || ev.title_en || '';
    if (!title || !ev.start_time) { skipped++; continue; }

    // Bygg eventpulseSummary-input (community-category, ingen artist)
    const input: EventpulseFactsInput = {
      title,
      category_slug: 'community',
      venue_name: ev.venue_full_name,
      city: ev.venue_city,
      start_time: ev.start_time,
      is_free: ev.is_free,
      price_min_sek: ev.price_min_sek,
      source: ev.source,
      raw_description: ev.raw_description,
      performers: [],
      city_is_stockholm: (ev.venue_city ?? '').toLowerCase().includes('stockholm'),
    };

    // Bygg deterministisk summary (title-fallback aktiverat för community)
    const result = buildEventpulseFacts(input);
    const summary = buildEventpulseSummary(result.facts);
    if (!summary) { skipped++; continue; }

    // Spara i DB
    const { error } = await supabase
      .from('events')
      .update({
        eventpulse_summary: summary,
        eventpulse_summary_facts: result.facts as unknown as Record<string, unknown>,
        eventpulse_summary_provenance: result.provenance as unknown as Record<string, unknown>,
        eventpulse_summary_generated_at: new Date().toISOString(),
        eventpulse_summary_model: 'deterministic-v1+title-fallback',
      })
      .eq('id', ev.id);
    if (error) { failed++; continue; }
    fixed++;
  }

  console.log(`\n  Resultat:`);
  console.log(`    ✓ Fixade:  ${fixed}`);
  console.log(`    – Skippade: ${skipped} (saknar titel+datum)`);
  console.log(`    ✗ Fel:     ${failed}`);
  console.log('═'.repeat(70));
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
