import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Räkna direkt
  const { count: r1 } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'folkoperan')
    .eq('title_sv', 'Folkoperan');
  console.log(`title_sv='Folkoperan': ${r1}`);

  const { count: r2 } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'folkoperan')
    .eq('title_en', 'Folkoperan');
  console.log(`title_en='Folkoperan': ${r2}`);

  // Hur ser en fixad rad ut?
  const { data: fixed } = await c
    .from('events')
    .select('id, title_sv, title_en, start_time, updated_at')
    .eq('source', 'folkoperan')
    .neq('title_sv', 'Folkoperan')
    .neq('title_en', 'Folkoperan')
    .order('updated_at', { ascending: false })
    .limit(5);
  console.log(`\nFörsta 5 fixade rader (senaste updated_at):`);
  for (const r of fixed ?? []) {
    console.log(`  ${r.id.slice(0, 8)} | sv=${JSON.stringify(r.title_sv)} | en=${JSON.stringify(r.title_en)}`);
    console.log(`    start=${r.start_time} updated=${r.updated_at}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });