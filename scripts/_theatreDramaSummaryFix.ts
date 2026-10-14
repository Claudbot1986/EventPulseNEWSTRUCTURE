/**
 * _theatreDramaSummaryFix.ts — 2026-10-14.
 *
 * Riktad fix för theatre-drama events som saknar eventpulse_summary.
 * Deterministiskt template (ingen LLM) som bygger från
 * title+category_slug+venue_full_name+venue_city+start_time.
 *
 * Bakgrund (Fas 3 / Theatre-drama, 2026-10-14):
 *   - buildEventpulseSummary returnerade null för theatre-drama-events
 *     utan artist+venue. Detta gjorde att 23+ events fick NULL summary.
 *   - Fix i eventpulseSummary.ts: title-fallback aktiverat för ALLA
 *     event-typer (inte bara community), så theatre-drama, exhibition,
 *     festival, sport, screening, workshop, standup, theater får alla
 *     title-fallback när artist+venue saknas.
 *   - Detta script kör backfill på redan-insertade theatre-drama events
 *     som fortfarande har NULL summary.
 *
 * Säkerhet:
 *   - ALDRIG raw_description som input till M3 (denna kod använder inte M3).
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx scripts/_theatreDramaSummaryFix.ts
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

  // Hämta theatre-drama events som saknar eventpulse_summary
  const PAGE = 500;
  const all: DbEvent[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('events')
      .select(`
        id, title_sv, title_en, category_slug, venue_full_name, venue_city,
        start_time, is_free, price_min_sek, source, raw_description
      `)
      .eq('category_slug', 'theatre-drama')
      .gt('start_time', now)
      .is('eventpulse_summary', null)
      .range(from, from + PAGE - 1);
    if (error) { console.error('Fel:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...(data as DbEvent[]));
    if (data.length < PAGE) break;
  }

  console.log('═'.repeat(70));
  console.log(`  Theatre-Drama Summary Fix — ${all.length} events utan description`);
  console.log('═'.repeat(70));

  if (all.length === 0) {
    console.log('  Inget att göra. Alla theatre-drama events har summary.');
    return;
  }

  let fixed = 0, skipped = 0, failed = 0;
  for (const ev of all) {
    const title = ev.title_sv || ev.title_en || '';
    if (!title || !ev.start_time) { skipped++; continue; }

    const input: EventpulseFactsInput = {
      title,
      category_slug: 'theatre-drama',
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

    const result = buildEventpulseFacts(input);
    const summary = buildEventpulseSummary(result.facts);
    if (!summary) { skipped++; continue; }

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
  console.log(`    – Skippade: ${skipped}`);
  console.log(`    ✗ Fel:     ${failed}`);
  console.log('═'.repeat(70));
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
