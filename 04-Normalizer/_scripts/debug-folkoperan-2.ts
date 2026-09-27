import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Test: hämta EN rad utan source_url
  const r = await c.from('events').select('id, source, title_sv, source_id, ticket_url, created_at, venue_name')
    .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan')
    .order('created_at', { ascending: false })
    .range(0, 4);
  console.log('Test (utan source_url):', JSON.stringify(r.data, null, 2), 'error:', r.error?.message ?? 'none');

  // Hämta alla 106 med rätt kolumner
  const all: any[] = [];
  let offset = 0;
  const PAGE = 200;
  while (true) {
    const { data, error } = await c.from('events').select('id, source, title_sv, source_id, ticket_url, created_at, venue_name')
      .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log('');
  console.log(`Totalt ${all.length} events med titel "Folkoperan"`);
  console.log('');

  // source_id-mönster
  const sourceIds = new Map<string, number>();
  for (const r of all) {
    sourceIds.set(r.source_id ?? '(null)', (sourceIds.get(r.source_id ?? '(null)') ?? 0) + 1);
  }
  console.log('source_id-värden (top 10):');
  for (const [s, n] of Array.from(sourceIds.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(n).padStart(4)} — ${s}`);
  }

  // Skapa datumintervall
  console.log('');
  console.log('FÖRSTA 5 events (sorterade på created_at desc):');
  for (const r of all.slice(0, 5)) {
    console.log(`  ${r.id.slice(0, 8)} | source=${r.source} | source_id=${r.source_id}`);
    console.log(`    created_at=${r.created_at}`);
    console.log(`    ticket=${r.ticket_url?.slice(0, 100) ?? '(null)'}`);
  }
  console.log('');
  console.log('SISTA 5 events (äldsta):');
  for (const r of all.slice(-5)) {
    console.log(`  ${r.id.slice(0, 8)} | source=${r.source} | source_id=${r.source_id}`);
    console.log(`    created_at=${r.created_at}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });