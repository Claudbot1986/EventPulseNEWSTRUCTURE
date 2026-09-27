import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Hämta 5 events med title_sv='Folkoperan' (INTE filtrera på source)
  const { data } = await c
    .from('events')
    .select('id, source, title_sv, title_en, source_url, ticket_url, start_time, created_at')
    .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('SAMPEL (5 senaste):');
  for (const r of data ?? []) {
    console.log(`  ${r.id.slice(0, 8)} | source=${JSON.stringify(r.source)} | start=${r.start_time}`);
    console.log(`    source_url=${r.source_url?.slice(0, 120) ?? '(null)'}`);
    console.log(`    ticket_url=${r.ticket_url?.slice(0, 120) ?? '(null)'}`);
    console.log(`    created_at=${r.created_at}`);
  }

  // Räkna hur många som har source='folkoperan' av dessa 106
  const { data: withFolkoperanSource } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan')
    .eq('source', 'folkoperan');

  const { data: withAnySource } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan');

  console.log('');
  console.log(`Av de 106 events med titel "Folkoperan":`);
  console.log(`  source='folkoperan':    ${withFolkoperanSource}`);
  console.log(`  alla:                    ${withAnySource}`);
}
main().catch((e) => { console.error(e); process.exit(1); });