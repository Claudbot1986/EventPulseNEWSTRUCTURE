import { createClient } from '@supabase/supabase-js';
import { lookupSubjects } from '../04-Normalizer/editorial/subjectCache';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date().toISOString();

  // Hämta 200 community-events
  const { data: events, error } = await sb.from('events')
    .select('id, title_sv, title_en, raw_description, venue_id, venues(name)')
    .eq('category_slug', 'community')
    .gt('start_time', now)
    .is('event_profile', null)
    .limit(200);
  if (error) { console.error(error); process.exit(1); }

  let hits = 0;
  const hitDetails: any[] = [];
  for (const ev of events ?? []) {
    const title = ev.title_sv || ev.title_en || '';
    const venue = (ev.venues as any)?.name ?? null;
    const raw = ev.raw_description ?? null;
    const candidates = [
      title,
      ...(title?.split(/[|]/) ?? []).map(s => s.trim()).filter(Boolean),
      venue,
      ...(title?.split(/[\s\-:&|,()!?.]+/) ?? []).map(w => w.trim()).filter(w => w.length >= 2),
    ];
    const lookups = lookupSubjects(candidates);
    const matched: string[] = [];
    for (const [k, v] of Object.entries(lookups)) {
      if (v) matched.push(v.name);
    }
    if (matched.length > 0) {
      hits++;
      hitDetails.push({ title: title.slice(0, 50), venue, matched });
    }
  }

  console.log(`Community events sampled: ${events?.length}`);
  console.log(`With subject hit:         ${hits} (${(100*hits/(events?.length||1)).toFixed(1)}%)`);
  console.log();
  console.log('=== EXAMPLES WITH HITS (15) ===');
  for (const d of hitDetails.slice(0, 15)) {
    console.log(`  ${d.title}`);
    console.log(`    @ ${d.venue}`);
    console.log(`    matched: ${d.matched.join(', ')}`);
  }
}
main();
