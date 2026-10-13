/**
 * _pullAllEvents.ts — Hämtar alla future events från Supabase och sparar
 * som JSONL för offline klusteranalys.
 *
 * Fält: id, title_sv, title_en, category_slug, source, venue_full_name,
 *       venue_city, raw_data (JSON-LD), raw_description, description_license,
 *       eventpulse_summary, start_time, is_free, price_min_sek, image_url.
 */
import { createClient } from '@supabase/supabase-js';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';

const OUT_PATH = resolve(process.cwd(), 'runtime/events-future-2026-10-13.jsonl');

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date().toISOString();
  const out = createWriteStream(OUT_PATH, { encoding: 'utf-8' });

  console.log('Hämtar alla future events...');
  let from = 0;
  const pageSize = 1000;
  let total = 0;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select(`
        id, title_sv, title_en, category_slug, source, venue_full_name, venue_city,
        raw_data, raw_description, description_license,
        eventpulse_summary, start_time, is_free, price_min_sek, image_url,
        event_profile, editorial_description
      `)
      .gt('start_time', now)
      .range(from, from + pageSize - 1);
    if (error) {
      console.error('Fel:', error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      out.write(JSON.stringify(row) + '\n');
    }
    total += data.length;
    if (total % 2000 < 1000) console.log(`  ... ${total} events`);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  out.end();
  console.log(`✓ Skrev ${total} events till ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
